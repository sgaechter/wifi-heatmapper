"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { readSettingsFromFile, writeSettingsToFile } from "../lib/fileHandler";
import {
  hasLocalStorageData,
  hasMigrated,
  migrateLocalStorageToFiles,
} from "../lib/localStorageMigration";
import { toast } from "./ui/use-toast";
import {
  HeatmapSettings,
  SurveyPoint,
  SurveyPointActions,
  TestSeries,
} from "../lib/types";
import { join } from "path";

/**
 * getDefaults()
 * @param floorPlan - desired floor plan, or "" if unknown
 * @returns Set of default settings for that floor plan
 */
const DEFAULT_SERIES_ID = "default";

export const getDefaults = (floorPlan: string): HeatmapSettings => {
  return {
    surveyPoints: [],
    floorplanImageName: floorPlan,
    floorplanImagePath: join("/media", floorPlan),
    currentSeriesId: DEFAULT_SERIES_ID,
    series: [
      {
        id: DEFAULT_SERIES_ID,
        name: "Default",
        createdAt: Date.now(),
      },
    ],
    iperfServerAdrs: "localhost",
    apMapping: [],
    testDuration: 1,
    sudoerPassword: "",
    nextPointNum: 1,
    dimensions: { width: 100, height: 100 },
    radiusDivider: null,
    maxOpacity: 0.7,
    minOpacity: 0.2,
    blur: 0.99,
    gradient: {
      0: "rgba(255, 0, 0, 0.6)", // 0%, -100 dBm
      0.45: "rgba(255, 255, 0, 0.6)", // 45%, -73 dBm
      0.5: "rgba(0, 0, 255, 0.6)", // 40%, -76 dBm
      0.6: "rgba(0, 255, 255, 0.6)", // 60%, -64 dBm
      0.75: "rgba(0, 255, 0, 0.6)", // 75%, -55 dBm
      0.9: "rgba(0, 255, 0, 0.6)", // 90%, -46 dBm
      1.0: "rgba(0, 255, 0, 0.6)", // 100%, -40 dBm
    },
    iperfCommands: {
      tcpDownload: "iperf3 -c {server} {port} -t {duration} -R -J",
      tcpUpload: "iperf3 -c {server} {port} -t {duration} -J",
      udpDownload: "iperf3 -c {server} {port} -t {duration} -R -u -b 100M -J",
      udpUpload: "iperf3 -c {server} {port} -t {duration} -u -b 100M -J",
    },
    // these two props were used for the "scan-wifi" branch
    // that has been (temporarily?) abandoned
    // sameSSID: "same",
    // ignoredSSIDs: ["AP-WH4E-C0BFBE6ACDA3", "LochLymeLodge-UB"],
  };
};

interface SettingsContextType {
  settings: HeatmapSettings;
  updateSettings: (newSettings: Partial<HeatmapSettings>) => void;
  surveyPointActions: SurveyPointActions;
  readNewSettingsFromFile: (theFile: string, seriesId?: string) => void;
  createTestSeries: (name: string) => string;
  switchTestSeries: (seriesId: string) => void;
}

// Create the context
const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

// Custom hook to use the settings context
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettings must be used within a SettingsProvider");
  return context;
}

// Context provider component
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<HeatmapSettings>(getDefaults(""));
  const [floorplanImage, setFloorplanImage] = useState<string>("");
  const [seriesIdToLoad, setSeriesIdToLoad] = useState<string | undefined>(
    undefined,
  );
  const migrationDone = useRef(false);
  const defaultFloorPlan = "EmptyFloorPlan.png";

  // Load settings (and migrate on first run)
  useEffect(() => {
    async function loadSettings() {
      // One-time migration from localStorage
      if (!migrationDone.current) {
        if (hasLocalStorageData() && !hasMigrated()) {
          console.log("Migrating localStorage data to file-based storage...");
          const count = await migrateLocalStorageToFiles();
          console.log(`Migration complete. Migrated ${count} survey(s).`);
          if (count > 0) {
            toast({
              title: "Survey data migrated",
              description: `Migrated ${count} survey(s) from browser storage to data/surveys/. Your data is now stored as JSON files.`,
            });
          }
        }
        migrationDone.current = true;
      }

      // Load settings for current floorplan / series
      const floorPlanToLoad = floorplanImage || defaultFloorPlan;
      const seriesToLoad = seriesIdToLoad || settings.currentSeriesId;
      const [newHeatmapSettings, envConfig] = await Promise.all([
        readSettingsFromFile(floorPlanToLoad, seriesToLoad),
        fetch("/api/env-config")
          .then((res) =>
            res.ok
              ? res.json()
              : { sudoerPassword: "", iperfServerAdrs: "localhost" },
          )
          .catch(() => ({ sudoerPassword: "", iperfServerAdrs: "localhost" })),
      ]);

      // Merge with defaults to ensure all fields exist (handles old/incomplete files)
      const defaults = getDefaults(floorPlanToLoad);
      if (newHeatmapSettings) {
        const mergedSettings = {
          ...defaults,
          ...newHeatmapSettings,
          sudoerPassword: envConfig.sudoerPassword || "",
          iperfServerAdrs:
            newHeatmapSettings.iperfServerAdrs ||
            envConfig.iperfServerAdrs ||
            "localhost",
        };
        setSettings(mergedSettings);
      } else {
        const initial = {
          ...defaults,
          currentSeriesId: seriesToLoad,
          sudoerPassword: envConfig.sudoerPassword || "",
          iperfServerAdrs: envConfig.iperfServerAdrs || "localhost",
        };
        writeSettingsToFile(initial);
        setSettings(initial);
      }
      setSeriesIdToLoad(undefined);
    }
    loadSettings();
  }, [floorplanImage, seriesIdToLoad]);

  const readNewSettingsFromFile = (fileName: string, seriesId?: string) => {
    setFloorplanImage(fileName);
    if (seriesId) {
      setSeriesIdToLoad(seriesId);
    }
  };

  // Function to update settings (only allows partial updates)
  const updateSettings = (newSettings: Partial<HeatmapSettings>) => {
    setSettings((prev) => {
      const updatedSettings = { ...prev, ...newSettings };
      writeSettingsToFile(updatedSettings);
      return updatedSettings;
    });
  };

  /**
   * createTestSeries - create a new test series for the current floorplan.
   * If points exist, copy their positions as placeholder points (white, no measurement).
   * Returns the new series id.
   */
  const createTestSeries = (name: string): string => {
    const newSeriesId = `series_${Date.now()}`;
    const newSeries: TestSeries = {
      id: newSeriesId,
      name: name.trim() || newSeriesId,
      createdAt: Date.now(),
    };

    const placeholderPoints: SurveyPoint[] = settings.surveyPoints.map(
      (point) => ({
        ...point,
        seriesId: newSeriesId,
        hasMeasurement: false,
        isEnabled: true,
      }),
    );

    const newSettings: HeatmapSettings = {
      ...settings,
      currentSeriesId: newSeriesId,
      series: [...settings.series, newSeries],
      surveyPoints: placeholderPoints,
      nextPointNum: 1,
    };

    updateSettings(newSettings);
    return newSeriesId;
  };

  /**
   * switchTestSeries - load a different test series for the current floorplan.
   */
  const switchTestSeries = (seriesId: string) => {
    readNewSettingsFromFile(settings.floorplanImageName, seriesId);
  };

  // SurveyPoint actions
  // add, update, and delete a point in the surveyPoints array
  // grouped into an object
  const surveyPointActions: SurveyPointActions = {
    add: (newPoint: SurveyPoint) => {
      const newPoints = [...settings.surveyPoints, newPoint];
      updateSettings({ surveyPoints: newPoints });
    },

    update: (thePoint: SurveyPoint, updatedData: object) => {
      const newPoints = settings.surveyPoints.map((point) =>
        point.id === thePoint.id ? { ...point, ...updatedData } : point,
      );
      updateSettings({ surveyPoints: newPoints });
    },

    delete: (points: SurveyPoint[]) => {
      const pointsToRemove = new Set(points.map((point) => point.id));
      const newPoints = settings.surveyPoints.filter(
        (point) => !pointsToRemove.has(point.id),
      );
      updateSettings({ surveyPoints: newPoints });
    },
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        surveyPointActions,
        readNewSettingsFromFile,
        createTestSeries,
        switchTestSeries,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
