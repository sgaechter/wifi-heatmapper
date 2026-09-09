# Floorplan-Kontextmenü und Survey-Export/Import

## Zusammenfassung

Folgende neuen Features wurden im Node.js-Projekt umgesetzt:

1. **Kontextmenü auf dem Floorplan (Rechtsklick)**
   - Erscheint, wenn der Benutzer auf einen bestehenden Messpunkt rechtsklickt.
   - Optionen:
     - **Re-measure point** – Messung an gleicher Position wiederholen, ohne neuen Punkt zu erstellen.
     - **Rename point** – Anzeigenamen des Punkts ändern.
     - **Deactivate / Activate point** – Punkt aus der Heatmap aus-/einblenden.
     - **Delete point** – Punkt löschen.

2. **Export / Import einer kompletten Messung**
   - Im Settings-Editor stehen zwei Buttons zur Verfügung: **Export survey** und **Import survey**.
   - Der Export erzeugt eine JSON-Datei mit allen Messdaten und dem Floorplan-Bild als Base64.
   - Der Import liest diese Datei, speichert Floorplan-Bild und Messdaten auf dem Server und lädt die Umfrage.

## Im Node.js-Projekt geänderte Dateien

| Datei | Änderung |
|---|---|
| `src/components/Floorplan.tsx` | Rechtsklick-Handler, Kontextmenü, Rename-Dialog, Re-measure-Logik |
| `src/components/SettingsEditor.tsx` | Export/Import-Buttons und Dateiauswahl |
| `src/app/api/export/route.ts` | Neue API-Route: Export als JSON inkl. Base64-Bild |
| `src/app/api/import/route.ts` | Neue API-Route: Import aus JSON, Wiederherstellung von Bild + Daten |

## Technische Details

### Kontextmenü

- Das Menü wird als fix positionierter `div` neben dem Mauszeiger gerendert.
- Ein transparentes Overlay über dem gesamten Bildschirm schließt das Menü bei Klick außerhalb oder bei erneutem Rechtsklick.
- Das Hover-Tooltip (`PopupDetails`) bleibt erhalten, blockiert aber das Menü nicht.
- Beim Re-measure wird der bestehende Punkt aktualisiert (`surveyPointActions.update`), nicht ein neuer Punkt hinzugefügt.

### Export-Format

```json
{
  "version": 1,
  "exportedAt": "2026-09-09T12:34:56.789Z",
  "floorplanImageName": "House___Garage.jpg",
  "imageMime": "image/jpeg",
  "imageBase64": "/9j/4AAQ...",
  "settings": { ... }
}
```

- `settings` enthält die gesamten `HeatmapSettings` (Punkte, Gradient, AP-Mapping, etc.).
- Das Passwortfeld wird vor dem Speichern entfernt.
- Der Download-Dateiname entspricht dem Floorplan-Namen, z. B. `House___Garage.jpg.wifiheatmap.json`.

### Import

- Der Import schreibt:
  - `data/surveys/<floorplanImageName>.json`
  - `public/media/<floorplanImageName>`
- Anschließend wird die Umfrage im Frontend über `readNewSettingsFromFile` neu geladen.

## Übernahme in den Python-Re-Write

Für den Python-Re-Write sollten diese Features von Anfang an eingeplant werden:

### 1. Datenmodell

Das Python-Äquivalent von `HeatmapSettings` sollte Folgendes unterstützen:

```python
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class SurveyPoint:
    id: str
    x: float
    y: float
    isEnabled: bool
    wifiData: WifiResults
    iperfData: Optional[IperfResults]
    timestamp: int

@dataclass
class HeatmapSettings:
    surveyPoints: List[SurveyPoint] = field(default_factory=list)
    floorplanImageName: str = ""
    floorplanImagePath: str = ""
    apMapping: List[ApMapping] = field(default_factory=list)
    gradient: dict = field(default_factory=dict)
    # ... weitere Felder
```

### 2. Floorplan-Interaktion

Im Frontend (z. B. Plotly/Bokeh/Streamlit) sollte die Punkt-Interaktion folgende Ereignisse unterstützen:

| Ereignis | Aktion |
|---|---|
| Linksklick auf leere Fläche | Neuen Punkt messen |
| Linksklick auf Punkt | Tooltip anzeigen |
| Rechtsklick auf Punkt | Kontextmenü öffnen |
| Kontextmenü: Re-measure | Messung an gleicher Stelle wiederholen |
| Kontextmenü: Rename | Dialog/Inline-Edit für Punkt-ID |
| Kontextmenü: Toggle | `isEnabled` umschalten |
| Kontextmenü: Delete | Punkt entfernen |

Plotly unterstützt Rechtsklicks über `plotly.js` Events (`contextmenu`), Bokeh über `CustomJS`. Streamlit bietet eingeschränkte Canvas-Interaktion, daher wäre hier eine separates HTML/JS-Frontend sinnvoller.

### 3. Export/Import

Backend-Funktionen:

```python
def export_survey(settings: HeatmapSettings) -> dict:
    image_path = Path("public/media") / settings.floorplanImageName
    image_base64 = base64.b64encode(image_path.read_bytes()).decode() if image_path.exists() else ""
    return {
        "version": 1,
        "exportedAt": datetime.utcnow().isoformat(),
        "floorplanImageName": settings.floorplanImageName,
        "imageMime": guess_type(settings.floorplanImageName)[0] or "image/png",
        "imageBase64": image_base64,
        "settings": asdict(settings),
    }

def import_survey(payload: dict) -> str:
    name = payload["floorplanImageName"]
    # Speichere Bild
    if payload.get("imageBase64"):
        image_bytes = base64.b64decode(payload["imageBase64"])
        (Path("public/media") / name).write_bytes(image_bytes)
    # Speichere Settings
    settings = HeatmapSettings(**payload["settings"])
    save_settings(settings)
    return name
```

Frontend:
- Export-Button löst einen Download aus.
- Import-Button lädt eine `.wifiheatmap.json`-Datei hoch.

### 4. Sicherheit

- Passwörter und andere sensible Daten dürfen nie in Exportdateien landen.
- Beim Import sollten unbekannte Felder ignoriert und das Schema validiert werden.
- Dateinamen müssen gesäubert werden (kein Path-Traversal).
- Optional können sudo-Passwort und iperf3-Serveradresse in einer `.env`-Datei auf dem Server hinterlegt werden, siehe `.env.example`.

### 5. Erweiterungen für später

- Export mehrerer Umfragen als ZIP.
- Automatische Migration alter Exportformate.
- CloudKey-Integration: AP-Mapping in den Export mitaufnehmen.
