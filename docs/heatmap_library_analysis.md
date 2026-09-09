# Heatmap-Bibliotheken-Analyse für den WiFi-Heatmapper Python-Re-Write

## Ausgangslage im aktuellen Projekt

Im aktuellen WiFi-Heatmapper (Next.js / TypeScript) wird die Heatmap client-seitig mit **WebGL** und einem eigenen Fragment-Shader berechnet. Die Logik umfasst:

- Einen Gradienten (Farb-Lookup-Tabelle, 1D-Textur).
- Eine variable Einflussradius-Berechnung pro Messpunkt.
- Alpha-Blending mit Hintergrundbild (Floorplan).
- Darstellung in einem HTML-Canvas.

Beim Re-Write in Python bleibt die Frage, wie die Heatmap visualisiert wird. Da die Anwendung weiterhin browserbasiert bleiben soll, sind folgende Browser-optimierte Python-Bibliotheken in Betracht zu ziehen:

- **Bokeh**
- **Plotly**
- **Lightning**
- **Altair**

---

## Kurzvergleich

| Bibliothek | Interaktivität | Heatmap-geeignet | Offline/HTML-Export | Einbettung in GUI | Python-Ökosystem | Status/Aktivität |
|---|---|---|---|---|---|---|
| **Bokeh** | Sehr gut | Gut (image, rect, scatter) | Ja, eigenes HTML/JS | sehr gut (Flask/FastAPI/Tornado) | gut | aktiv |
| **Plotly** | Sehr gut | Hervorragend (`go.Heatmap`, `go.Densitymapbox`) | Ja, eigenständige HTML | sehr gut (Dash, Streamlit, Flask) | sehr gut | sehr aktiv |
| **Lightning** | Mittel | Nur über Scatter/Rects | Ja, aber weniger flexibel | mittel | klein | **inaktiv / veraltet** |
| **Altair** | Sehr gut | Gut (mark_rect, mark_circle) | Ja, Vega/Vega-Lite JSON/HTML | sehr gut (Jupyter, Streamlit) | sehr gut | aktiv |

---

## 1. Bokeh

### Stärken
- Native Interaktivität: Pan, Zoom, Hover-Tooltips, Slider, Buttons.
- Kann direkt Python-Callbacks an JavaScript schicken (`CustomJS`).
- Gute Kontrolle über Bilder (Floorplan als `image_rgba`), Scatter-Punkte und Rechtecke.
- Leicht in FastAPI/Flask/Tornado einzubetten.
- Kein JavaScript-Know-how nötig für einfache Interaktionen.

### Schwächen
- Heatmaps mit kontinuierlichem Farbverlauf müssen selbst als `image_rgba` generiert werden oder als Raster aus Rechtecken dargestellt werden.
- Weniger „batteries-included" für Heatmaps als Plotly.
- Die API ist etwas ausführlicher als Altair/Plotly.

### Einschätzung für WiFi-Heatmapper
Bokeh ist eine gute Wahl, wenn man die WebGL-Heatmap durch ein **Python-generiertes RGBA-Bild** ersetzen will. Man kann den Floorplan als Hintergrund legen, die Heatmap als transparentes Overlay darüber rendern und interaktiv Zoomen/Points auswählen. Bokeh passt besonders gut zu einer FastAPI-Backend-App, die ein eigenes Frontend bereitstellt.

---

## 2. Plotly (plotly.py)

### Stärken
- Eingebaute Heatmap-Typen: `go.Heatmap`, `go.Heatmapgl`, `go.Densitymapbox`.
- Hervorragende Interaktivität: Zoom, Pan, Box/Lasso-Selektion, Hover-Infos.
- Sehr einfacher HTML-Export (`fig.write_html()`).
- Einfache Integration in **Dash** oder **Streamlit** für komplexere GUIs.
- Umfangreiche Dokumentation und große Community.

### Schwächen
- `go.Heatmap` rendert ein Rechteckraster, keinen wirklich kontinuierlichen Radius-basierten Gradienten. Für einen Radius-Effekt muss man entweder:
  - eine feine Raster-Heatmap generieren (z. B. mit NumPy/SciPy),
  - oder Scatter-Marker mit Kreisverläufen nutzen,
  - oder `go.Image` mit einem selbst berechneten RGBA-Overlay verwenden.
- Lizenz: Plotly ist Apache 2.0, Plotly.js MIT, aber einige kommerzielle Dash-Features sind kostenpflichtig.

### Einschätzung für WiFi-Heatmapper
Plotly ist die **stärkste Alternative**, wenn man schnell zu einem interaktiven Ergebnis kommen will. Für den WiFi-Heatmapper wäre der beste Ansatz:

1. Heatmap-Dichte in Python berechnen (z. B. mit `scipy.ndimage.gaussian_filter` oder einem kustomen Kernel pro Messpunkt).
2. Ergebnis als `go.Image` oder `px.imshow` über den Floorplan legen (mit transparenter Farbskala).
3. Messpunkte als `go.Scatter` mit Hover-Infos für Detaildaten darüber legen.

Plotly ist besonders attraktiv, wenn das Python-Projekt später auf **Dash** oder **Streamlit** aufgebaut werden soll.

---

## 3. Lightning

### Stärken
- War ursprünglich für schnelle, webbasierte Visualisierungen gedacht.

### Schwächen
- Das Projekt ist **seit Jahren inaktiv** (letzte Releases vor 2017–2018).
- Sehr begrenzte Heatmap-Unterstützung.
- Kein nennenswertes Ökosystem mehr.
- Unsicherheit bezüglich Wartung und Sicherheit.

### Einschätzung für WiFi-Heatmapper
**Nicht empfohlen.** Für ein neues Projekt, das gewartet werden soll, ist Lightning keine sinnvolle Option.

---

## 4. Altair

### Stärken
- Deklarative API basierend auf **Vega-Lite**.
- Sehr gute interaktive Features: Zoom, Pan, Tooltip, Brushing, Verknüpfung mehrerer Views.
- Saubere Trennung von Daten (Dataframe) und Visualisierungsspezifikation.
- Gute Einbettung in HTML/Jupyter/Streamlit.

### Schwächen
- Altair/Vega-Lite ist **nicht für große Rasterbilder** optimiert. Eine hochaufgelöste Heatmap (z. B. 1000×1000 Pixel) würde sehr viele Mark-Objekte oder sehr große Datenmengen erzeugen.
- Für einen kontinuierlichen Farbverlauf mit variablen Einflussradius muss man selbst ein Bild vorberechnen und als `mark_image` anzeigen.
- Direkte Manipulation der Rendering-Pipeline ist schwieriger als in Bokeh/Plotly.

### Einschätzung für WiFi-Heatmapper
Altair ist eine gute Wahl für **statistische oder Dashboard-ähnliche Ansichten** (z. B. Heatmap-Statistiken, selektierte Punkte, Histogramme). Für die **Haupt-Heatmap mit Floorplan-Overlay und Radius-Effekt** ist Altair weniger geeignet als Bokeh oder Plotly, es sei denn, man berechnet die Heatmap als Bild in Python und nutzt Altair nur als Anzeigeschicht.

---

## Empfohlene Architektur für den Re-Write

Angesichts der Anforderungen (Floorplan-Hintergrund, Radius-basierte Heatmap, interaktive Messpunkte, Browser-Oberfläche) empfehle ich folgenden hybriden Ansatz:

### Kern: Python berechnet die Heatmap als RGBA-Bild

- Einflussradius und Farbgradient werden in Python/NumPy berechnet.
- Ergebnis ist ein transparentes RGBA-Bild im gewünschten Output-Format (z. B. PNG).
- Das Bild kann sowohl im Browser angezeigt als auch exportiert werden.

### Anzeigeschicht: Plotly oder Bokeh

| Szenario | Empfohlene Bibliothek |
|---|---|
| Schnellster Weg zu einer interaktiven Web-App | **Plotly** (+ optional Dash/Streamlit) |
| Volle Kontrolle über Canvas, Slider und Buttons | **Bokeh** |
| Statistische Begleitdiagramme / Dashboard | **Altair** |
| Nur Anzeige ohne viel Interaktion | **Plotly** oder reines HTML/Canvas |

### Nicht empfohlen

- **Lightning**: Inaktiv, ungeeignet.
- Reines Altair für die Haupt-Heatmap: Zu viele Datenpunkte, ineffizient.

---

## Empfehlung

Für den WiFi-Heatmapper Python-Re-Write wäre **Plotly** die erste Wahl:

1. Es bietet die beste Balance aus **Interaktivität**, **einfacher Integration** und **Community/Dokumentation**.
2. Das Floorplan-Bild kann als Layout-Hintergrund verwendet werden.
3. Die berechnete RGBA-Heatmap kann als `go.Image` überlagert werden.
4. Messpunkte werden als interaktiver `go.Scatter`-Layer mit Hover-Details dargestellt.
5. Mit `fig.write_html()` erhält man eine eigenständige, browserbasierte Ausgabe, die sich auch in ein FastAPI-Backend einbetten lässt.

**Bokeh** ist die bessere Alternative, wenn später sehr viel Custom-JavaScript-Interaktion nötig ist oder wenn man sich vom Vega/Plotly-Ökosystem abgrenzen möchte.

**Altair** kann ergänzend für Dashboards und begleitende Visualisierungen genutzt werden, sollte aber nicht die Haupt-Heatmap-Engine sein.
