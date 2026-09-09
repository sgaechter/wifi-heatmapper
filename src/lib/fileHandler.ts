/**
 * wifi-heatmapper file storage
 *
 * Survey data is stored as JSON files in data/surveys/
 * Each floorplan has its own file: data/surveys/<floorplanImageName>.json
 *
 * - readSettingsFromFile(fileName) reads the settings for a floorplan
 *   - Returns null if the file doesn't exist (caller should provide defaults)
 *
 * - writeSettingsToFile(settings) saves settings to a file
 *   - The filename is derived from settings.floorplanImageName
 *   - Sensitive data (sudoerPassword) is stripped before saving
 */

import { HeatmapSettings } from "./types";

export async function readSettingsFromFile(
  fileName: string,
  seriesId?: string,
): Promise<HeatmapSettings | null> {
  try {
    if (!fileName) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("name", fileName);
    if (seriesId) {
      params.set("seriesId", seriesId);
    }

    const response = await fetch(`/api/settings?${params.toString()}`);

    if (response.status === 404) {
      return null; // Survey doesn't exist yet
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? JSON.stringify(await response.json(), null, 2)
        : await response.text();
      console.error("Error reading settings:", body);
      return null;
    }

    const parsedData = await response.json();

    // Migration: Earlier versions used iperfResults instead of iperfData
    if (parsedData.surveyPoints?.[0]?.iperfResults !== undefined) {
      for (const point of parsedData.surveyPoints) {
        point.iperfData = point.iperfResults;
        delete point.iperfResults;
      }
    }

    // Migration: ensure series and currentSeriesId exist for older files
    if (!parsedData.currentSeriesId) {
      parsedData.currentSeriesId = "default";
    }
    if (!parsedData.series || parsedData.series.length === 0) {
      parsedData.series = [
        {
          id: "default",
          name: "Default",
          createdAt: Date.now(),
        },
      ];
    }

    return parsedData;
  } catch (error) {
    console.error("Error reading settings:", error);
    return null;
  }
}

export async function writeSettingsToFile(
  settings: HeatmapSettings,
): Promise<void> {
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? JSON.stringify(await response.json(), null, 2)
        : await response.text();
      console.error(
        `[wifi-heatmapper] Failed to save settings for "${settings.floorplanImageName}":`,
        response.status,
        response.statusText,
        body,
      );
    }
  } catch (error) {
    console.error(
      `[wifi-heatmapper] Failed to save settings for "${settings.floorplanImageName}":`,
      error,
    );
  }
}
