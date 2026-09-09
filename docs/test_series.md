# Testserien (Test Series) – Konzept und Umsetzung

## Ziel

Mehrere Messreihen für denselben Floorplan verwalten, um Veränderungen über die Zeit zu dokumentieren und zu vergleichen (z. B. vor und nach einer WLAN-Optimierung).

## Funktionen

1. **Neue Testserie anlegen**  
   Über den Button **„New test series" im Floorplan-Tab wird ein Dialog geöffnet, in dem der Benutzer einen Namen eingibt.

2. **Positionen übernehmen, Messwerte zurücksetzen**  
   Beim Anlegen einer neuen Serie werden die Positionen aller bestehenden Punkte kopiert. Die kopierten Punkte werden als **weiße Platzhalter** dargestellt (`hasMeasurement: false`).

3. **Punkt neu einmessen**  
   Über das Kontextmenü (Rechtsklick) kann ein Platzhalterpunkt neu gemessen werden. Die neuen Werte werden in der aktuellen Serie hinterlegt (`hasMeasurement: true`).

4. **Serien vergleichen**  
   Im Heatmap-Tab können zusätzliche Serien zum Vergleich ausgewählt werden. Für jede ausgewählte Serie wird die entsprechende Heatmap berechnet und angezeigt.

## Datenmodell

### Erweiterte Typen

```typescript
export interface TestSeries {
  id: string;
  name: string;
  createdAt: number;
}

export interface HeatmapSettings {
  // ... bisherige Felder
  currentSeriesId: string;
  series: TestSeries[];
}

export type SurveyPoint = {
  // ... bisherige Felder
  seriesId?: string;
  hasMeasurement?: boolean;
};
```

## Dateispeicherung

Jede Serie wird als eigenständige JSON-Datei gespeichert. Das verhindert, dass eine einzelne Datei unübersichtlich groß wird und erleichtert Backup/Export.

| Serie | Dateiname |
|---|---|
| Default | `data/surveys/EmptyFloorPlan.png.json` |
| Optimierung | `data/surveys/EmptyFloorPlan.png.optimierung.json` |

## API-Anpassungen

- `GET /api/settings?name=<floorplan>&seriesId=<id>` lädt eine bestimmte Serie.
- `POST /api/settings` speichert unter `currentSeriesId`.
- `GET /api/settings?list=true&name=<floorplan>` listet alle Serien eines Floorplans.

## Frontend-Anpassungen

| Datei | Änderung |
|---|---|
| `src/lib/types.ts` | `TestSeries`, `currentSeriesId`, `series[]`, `hasMeasurement` |
| `src/lib/fileHandler.ts` | `seriesId`-Parameter für Lesen |
| `src/app/api/settings/route.ts` | Serien-basierte Dateipfade |
| `src/components/GlobalSettings.tsx` | `createTestSeries`, `switchTestSeries`, Laden per Serie |
| `src/components/Floorplan.tsx` | Button + Dialog, weiße Platzhalter, Serien-Dropdown |
| `src/components/Heatmaps.tsx` | Vergleichsauswahl, Laden fremder Serien, Darstellung |

## Darstellung im Floorplan

- Normale Punkte: Farbe entsprechend Signalstärke.
- Deaktivierte Punkte: Grau.
- Platzhalter-Punkte (neue Serie): Weiß mit Beschriftung „no data".

## Darstellung in der Heatmap

- Aktuelle Serie wird immer berechnet.
- Ausgewählte Vergleichsserien werden zusätzlich berechnet.
- Jede Heatmap erhält einen Titel mit dem Seriennamen.

## Übernahme in den Python-Re-Write

### Datenmodell

```python
@dataclass
class TestSeries:
    id: str
    name: str
    createdAt: int

@dataclass
class SurveyPoint:
    # ... bisherige Felder
    seriesId: Optional[str] = None
    hasMeasurement: bool = True

@dataclass
class HeatmapSettings:
    # ... bisherige Felder
    currentSeriesId: str = "default"
    series: List[TestSeries] = field(default_factory=lambda: [
        TestSeries(id="default", name="Default", createdAt=0)
    ])
```

### Speicherlogik

```python
def get_survey_path(floorplan_name: str, series_id: str = "default") -> Path:
    sanitized = sanitize_filename(floorplan_name)
    if series_id == "default":
        return SURVEYS_DIR / f"{sanitized}.json"
    return SURVEYS_DIR / f"{sanitized}.{sanitize_filename(series_id)}.json"
```

### Ablauf neue Serie

1. Benutzer gibt Namen ein.
2. Neue Serien-ID wird generiert.
3. Alle aktuellen Punkte werden kopiert mit `seriesId=<neueId>`, `hasMeasurement=False`.
4. Neue JSON-Datei wird gespeichert.
5. UI wechselt zur neuen Serie.

### Ablauf Vergleich in Heatmap

1. Benutzer wählt Vergleichsserie(n).
2. Backend lädt die jeweiligen `surveyPoints` aus den Serien-Dateien.
3. Heatmap wird pro Serie und Metrik berechnet.
4. Optional: Zukünftig könnte eine echte Überlagerung (Difference-Heatmap) berechnet werden.

## Hinweise

- Platzhalterpunkte werden bei der Heatmap-Berechnung ausgeschlossen.
- Das aktive Wechseln zwischen Serien lädt deren Datei neu.
- Sensible Daten (Passwort) werden vor dem Speichern weiterhin entfernt.
