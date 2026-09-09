# CloudKey-/UniFi-API-Anbindung für den WiFi-Heatmapper

## Ziel

Eine Anbindung eines UniFi CloudKey (Dream Machine, CloudKey Gen2, UniFi OS-Konsole) soll es ermöglichen, zusätzliche AP-Daten in die Heatmap-Analyse einzubeziehen. Das kann helfen, Messungen besser zu verstehen, APs automatisch zu benennen, die tatsächliche AP-Position zu berücksichtigen und Band-/Kanal-Informationen zu ergänzen.

## Was ein CloudKey/UniFi-OS-Controller bietet

UniFi-Geräte werden über den UniFi OS Controller verwaltet. Dieser bietet eine REST-API (und teilweise WebSocket-Echtzeitdaten). Typische Endpunkte (je nach Controller-Version):

| Endpunkt | Beschreibung | Relevanz für Heatmapper |
|---|---|---|
| `/api/login` | Login mit lokalem Benutzer/Passwort | Authentifizierung |
| `/proxy/network/api/s/default/stat/device` | Liste aller APs/Switches/Gateway mit Status, MAC, Name, Position, Kanal, RX/TX | **Sehr hoch** |
| `/proxy/network/api/s/default/rest/device` | Detail-Konfiguration aller Geräte | AP-Namen, feste Positionen |
| `/proxy/network/api/s/default/stat/station` | Aktuell verbundene Clients | RSSI pro Client pro AP, Verbindungsdaten |
| `/proxy/network/api/s/default/stat/health` | Gesundheitsstatus des Netzwerks | Übersicht |
| `/proxy/network/api/s/default/rest/wlanconf` | WLAN-Konfigurationen (SSID, Sicherheit, Band) | SSID-zu-Band-Zuordnung |
| `/proxy/network/api/s/default/rest/map` | Floorpläne inkl. Bild-URL, Maßstab und AP-Positionen | **Sehr hoch** |
| `/proxy/network/api/s/default/rest/radiusprofile` | RADIUS-Profile | eher sekundär |
| `/proxy/network/api/s/default/stat/voucher` | Hotspot-Voucher | nicht relevant |

> Hinweis: Bei älteren UniFi-Controller-Versionen (5.x) lauteten die Pfade `/api/s/default/stat/device`. Bei UniFi OS 2.x/3.x/4.x werden die `/proxy/network/...`-Pfade verwendet.
> 
> ## Floorpläne aus dem UniFi-Controller
>
> Ja – der UniFi-Controller speichert die vom Benutzer hochgeladenen Floorpläne und darauf platzierte APs. Sie sind über die API abrufbar.
>
> ### Relevante Endpunkte
>
> | Endpunkt | Beschreibung |
> |---|---|
> | `/proxy/network/api/s/{site}/rest/map` | Liste aller Floorpläne (maps) mit Metadaten |
> | `/proxy/network/api/s/{site}/rest/map/{map_id}` | Details eines einzelnen Floorplans |
> | `/proxy/network/api/s/{site}/rest/device` | AP-Daten enthalten `x`, `y`, `z` pro Gerät (bezogen auf den zugeordneten Floorplan) |
>
> ### Struktur eines Floorplans (vereinfacht)
>
> ```json
> {
>   "_id": "5f1234567890abcdef123456",
>   "name": "Erdgeschoss",
>   "type": "floorplan",
>   "width": 1200.0,
>   "height": 800.0,
>   "img_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
>   "offset_x": 0.0,
>   "offset_y": 0.0,
>   "scale": 0.05,
>   "sites": [...]
> }
> ```
>
> Die `img_url` liefert das Bild entweder als Base64-Daten-URL oder als Pfad/URL zum Controller.
>
> ### Vorteile
>
> - **Kein erneuter Import** des Floorplans durch den Benutzer.
> - APs sind bereits in korrekten Koordinaten platziert.
> - Der Maßstab (`scale`) ist hinterlegt, sodass echte Entfernungen berechnet werden können.
>
> ### Einschränkungen
>
> - Der Benutzer muss den Floorplan zuvor in UniFi Network gepflegt haben.
> - AP-Positionen in UniFi sind oft nur grob gesetzt; trotzdem ist das ein guter Startpunkt.
> - Die Koordinaten müssen ggf. noch auf die gerenderte Bildgröße skaliert werden.
>
## Daten, die für den Heatmapper nützlich sind

### 1. Access-Point-Informationen

```json
{
  "name": "AP-Wohnzimmer",
  "mac": "aa:bb:cc:dd:ee:ff",
  "ip": "192.168.1.10",
  "x": 120.5,
  "y": 80.0,
  "z": 0.0,
  "scaled": true,
  "radio_table": [
    {
      "radio": "ng",
      "channel": 6,
      "tx_power": 20,
      "min_tx_power": 4,
      "max_tx_power": 20
    },
    {
      "radio": "na",
      "channel": 36,
      "tx_power": 23
    }
  ]
}
```

Mögliche Verwendung:
- **AP-Mapping**: BSSID → AP-Name automatisch auflösen.
- **AP-Positionen**: Wenn der Benutzer APs in der UniFi-Karte platziert hat (x, y, z), können diese als Overlay auf dem Floorplan angezeigt werden.
- **Kanal/Band**: Plausibilitätsprüfung der eigenen Messungen.

### 2. Station-/Client-Informationen

```json
{
  "mac": "11:22:33:44:55:66",
  "ap_mac": "aa:bb:cc:dd:ee:ff",
  "rssi": -62,
  "signal": 56,
  "channel": 36,
  "radio": "na",
  "essid": "MeinWLAN",
  "ip": "192.168.1.123"
}
```

Mögliche Verwendung:
- **Vergleichsreferenz**: Der CloudKey „sieht" das gleiche Gerät (das Mess-Laptop) mit seiner RSSI pro AP. Damit kann man die lokale WLAN-Messung des Laptops mit der Sicht des APs vergleichen.
- **Client-Roaming-Visualisierung**: Wenn mehrere APs den Laptop gleichzeitig sehen, kann man das Roaming-Verhalten darstellen.
- **Automatische BSSID-Zuordnung**: Der Client-Eintrag enthält `ap_mac`, das der aktuellen BSSID des Laptops entsprechen sollte.

### 3. WLAN-/SSID-Informationen

- Ermöglicht die Zuordnung von SSID zu den tatsächlich verwendeten Bändern (2.4 GHz / 5 GHz / 6 GHz).
- Hilft bei der Erklärung, warum ein Laptop plötzlich auf 2.4 GHz statt 5 GHz wechselt.

## Architektur für den Python-Re-Write

Für den Python-Re-Write lässt sich die CloudKey-Anbindung als separates Modul umsetzen, das optional aktiviert wird. Vorgeschlagene Struktur:

```
wifi_heatmapper/
├── scanners/
│   ├── __init__.py
│   ├── local_wifi.py       # aktuelles Betriebssystem-WiFi-Scanning
│   ├── cloudkey.py         # UniFi CloudKey API Client
│   └── iperf.py            # iperf3-Tests
├── models/
│   ├── survey_point.py
│   ├── access_point.py
│   └── wifi_results.py
├── heatmap/
│   └── renderer.py
└── web/
    └── app.py              # FastAPI/Flask/Streamlit-Frontend
```

### Modul `scanners/cloudkey.py`

Aufgaben:
- Login am CloudKey/UniFi OS.
- Session-Cookie/CSRF-Token-Verwaltung.
- Abruf und Caching der AP-/Client-/WLAN-Daten.
- Normalisierung der Daten in eigene Python-Dataclasses.

### Beispiel-API-Client (konzeptionell)

```python
import requests
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class AccessPoint:
    mac: str
    name: str
    x: Optional[float]
    y: Optional[float]
    radios: list

class UniFiCloudKeyClient:
    def __init__(self, host: str, username: str, password: str, site: str = "default", verify_ssl: bool = False):
        self.host = host.rstrip("/")
        self.username = username
        self.password = password
        self.site = site
        self.verify_ssl = verify_ssl
        self.session = requests.Session()
        self.session.verify = verify_ssl

    def login(self) -> None:
        url = f"{self.host}/api/login"
        payload = {"username": self.username, "password": self.password}
        r = self.session.post(url, json=payload)
        r.raise_for_status()

    def get_devices(self) -> List[AccessPoint]:
        # UniFi OS 2.x/3.x/4.x
        url = f"{self.host}/proxy/network/api/s/{self.site}/stat/device"
        r = self.session.get(url)
        r.raise_for_status()
        data = r.json().get("data", [])
        aps = []
        for d in data:
            if d.get("type") != "uap":
                continue
            aps.append(AccessPoint(
                mac=d.get("mac", ""),
                name=d.get("name", d.get("mac", "")),
                x=d.get("x"),
                y=d.get("y"),
                radios=d.get("radio_table", []),
            ))
        return aps

    def get_clients(self) -> List[dict]:
        url = f"{self.host}/proxy/network/api/s/{self.site}/stat/station"
        r = self.session.get(url)
        r.raise_for_status()
        return r.json().get("data", [])

    def get_maps(self) -> List[dict]:
        url = f"{self.host}/proxy/network/api/s/{self.site}/rest/map"
        r = self.session.get(url)
        r.raise_for_status()
        return r.json().get("data", [])

    def get_map_image(self, map_id: str) -> bytes:
        url = f"{self.host}/proxy/network/api/s/{self.site}/rest/map/{map_id}"
        r = self.session.get(url)
        r.raise_for_status()
        data = r.json().get("data", [])
        if not data:
            return b""
        img_url = data[0].get("img_url", "")
        # img_url ist entweder eine base64-Daten-URL oder ein relativer Pfad
        if img_url.startswith("data:"):
            # base64-Daten-URL
            import base64
            b64 = img_url.split(",", 1)[1]
            return base64.b64decode(b64)
        # ansonsten als relativer Pfad zum Controller auflösen
        img_url = img_url if img_url.startswith("http") else f"{self.host}{img_url}"
        r = self.session.get(img_url)
        r.raise_for_status()
        return r.content
```

## Integration in den Heatmapper

### 1. Settings-Erweiterung

In den Einstellungen (`HeatmapSettings` bzw. Python-Äquivalent) sollten folgende neue Felder hinzukommen:

- `cloudkey_host`: URL des CloudKey/UDM, z. B. `https://192.168.1.2`.
- `cloudkey_username`: Lokaler UniFi-Benutzer.
- `cloudkey_password`: Lokales Passwort (niemals speichern!).
- `cloudkey_site`: Standardmäßig `default`.
- `cloudkey_enabled`: Boolean-Schalter.
- `cloudkey_use_positions`: AP-Positionen aus der UniFi-Karte verwenden.
- `cloudkey_ap_overlay`: APs als Symbole auf dem Floorplan anzeigen.
- `cloudkey_map_id`: Auswahl, welcher UniFi-Floorplan verwendet werden soll.
- `cloudkey_import_floorplan`: Floorplan-Bild automatisch aus UniFi übernehmen.

> Sicherheitshinweis: Das Passwort darf nicht in JSON-Speicher/Dateien gespeichert werden. Es sollte nur im Arbeitsspeicher gehalten oder optional über Umgebungsvariablen/Keyring bereitgestellt werden.

### 2. AP-Mapping

Das `ApMapping` aus `types.ts` könnte automatisch befüllt werden:

```python
def resolve_ap_name(bssid: str, access_points: List[AccessPoint]) -> Optional[str]:
    normalized = normalize_mac(bssid)
    for ap in access_points:
        if normalize_mac(ap.mac) == normalized:
            return ap.name
    return None
```

Damit entfällt die manuelle Eingabe der AP-Namen (siehe To-Do.md: „AP Mapping tab").

### 3. Zusätzliche Anzeige-Layer

| Layer | Datenquelle | Nutzen |
|---|---|---|
| AP-Standorte | CloudKey `x`/`y` oder manuell korrigiert | Zeigt, wo sich APs physikalisch befinden |
| AP-Namen | CloudKey `name` | Popup-Details der Survey-Punkte ergänzen |
| AP-Reichweitenkreise | CloudKey `radio_table` + Schätzung | Visualisierung der erwarteten Abdeckung |
| Client-RSSI-Vergleich | CloudKey `stat/station` | Vergleich Laptop-RSSI vs. AP-RSSI |

### 4. Datenvalidierung

Die CloudKey-Daten können dazu dienen, lokale Messungen zu validieren:

- Stimmt die gemessene BSSID mit dem aktuell verbundenen AP überein?
- Ist die gemessene Kanal-/Band-Information konsistent?
- Welcher AP hat den Laptop zum Zeitpunkt der Messung gesehen (Roaming-Check)?

## UX-Vorschläge

1. **Optionaler Schalter** in den Einstellungen: „CloudKey/UniFi API verwenden".
2. **Verbindungstest**: Ein Button „Test Connection" prüft Login und Berechtigungen.
3. **Floorplan importieren**: Der Benutzer kann einen der in UniFi hinterlegten Floorpläne samt Bild und AP-Positionen übernehmen – kein erneuter Import nötig.
4. **AP-Positionen importieren**: Falls APs in der UniFi-Karte positioniert sind, können diese skaliert auf den Floorplan übertragen werden (Der Benutzer kann optional zwei Referenzpunkte setzen, um UniFi-Koordinaten zu korrigieren).
5. **Automatisches AP-Mapping**: Survey-Punkte erhalten automatisch den AP-Namen aus dem CloudKey, wenn BSSID übereinstimmt.
5. **Sync während Messung**: Vor/nach jeder Messung die aktuellen Client-Daten vom CloudKey abrufen, um die AP-Sicht der eigenen Messung zu erfassen.

## Technische Herausforderungen

| Herausforderung | Lösungsansatz |
|---|---|
| SSL-Zertifikat des CloudKey meist selbstsigniert | `verify=False` oder CA importieren, Benutzer warnen |
| CSRF-Token bei neueren Versionen | Session-Cookie und ggf. Header `X-CSRF-Token` aus Login-Response extrahieren |
| Unterschiedliche API-Pfade je nach Version | Auto-Detection: zuerst `/proxy/network/...` probieren, Fallback auf `/api/s/...` |
| Passwort-Speicherung | Nicht speichern; optional Keyring-Integration (`keyring` Paket) |
| CloudKey nicht erreichbar | Feature deaktivieren, Anwendung läuft ohne weiter |
| Mehrere Sites | Site-ID konfigurierbar machen (default: `default`) |
| Rate-Limiting / Performance | Ergebnisse cachen (z. B. 5–10 Sekunden), nicht bei jeder Interaktion neu abfragen |

## Empfohlene Implementierungsreihenfolge

1. **PoC-Modul**: Login + Abruf `/stat/device` in Python.
2. **AP-Mapping**: BSSID → Name in bestehende Survey-Point-Details integrieren.
3. **Floorplan-Import**: Ausgewählten UniFi-Floorplan in das Projekt übernehmen.
4. **AP-Overlay**: AP-Standorte als Scatter-Layer in der Heatmap anzeigen.
5. **Client-RSSI-Vergleich**: Station-Daten abrufen und in Popup-Details einblenden.
6. **Positionsimport**: UniFi-Koordinaten auf Floorplan skalieren (optional, da viele Benutzer APs nicht exakt in UniFi platziert haben).

## Fazit

Eine CloudKey-API-Anbindung würde den WiFi-Heatmapper deutlich wertvoller machen:

- Automatische AP-Erkennung und -Benennung.
- Zusätzliche Validierungsebene für eigene Messungen.
- Bessere Visualisierung durch AP-Standorte und -Reichweiten.
- Reduzierter manueller Aufwand für den Benutzer.

Sie sollte als **optionales Feature** implementiert werden, das die Kernfunktionalität (lokale WLAN-Messung + iperf3) nicht ersetzt, sondern ergänzt. Für den Python-Re-Write lässt sich das sauber als separates `cloudkey.py`-Scanner-Modul umsetzen, das in den Settings aktiviert und in der Datendarstellung verwendet wird.
