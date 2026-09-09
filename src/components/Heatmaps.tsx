import React, { useCallback, useEffect, useRef, useState } from "react";

import { useSettings } from "@/components/GlobalSettings";

import { calculateRadiusByBoundingBox } from "../lib/radiusCalculations";

import {
  SurveyPoint,
  testProperties,
  MeasurementTestType,
  testTypes,
} from "@/lib/types";
import { getColorAt, objectToRGBAString } from "@/lib/utils-gradient";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { HeatmapSlider } from "./Slider";

import { IperfTestProperty } from "@/lib/types";
import { metricFormatter } from "@/lib/utils";
import { getLogger } from "@/lib/logger";
import createHeatmapWebGLRenderer from "../app/webGL/renderers/mainRenderer";
import HeatmapImage from "./HeatmapImage";
import HeatmapModal from "./HeatmapModal";

const logger = getLogger("Heatmaps");

const metricTitles: Record<MeasurementTestType, string> = {
  signalStrength: "Signal Strength",
  tcpDownload: "TCP Download",
  tcpUpload: "TCP Upload",
  udpDownload: "UDP Download",
  udpUpload: "UDP Upload",
};

const propertyTitles: Record<keyof IperfTestProperty, string> = {
  bitsPerSecond: "Bits Per Second [Mbps]",
  jitterMs: "Jitter [ms] (UDP Only)",
  lostPackets: "Lost Packets (UDP Only)",
  retransmits: "Retransmits (TCP Download Only)",
  packetsReceived: "Packets Received (UDP Only)",
  signalStrength: "dBm or %",
};

const getAvailableProperties = (
  metric: MeasurementTestType,
): (keyof IperfTestProperty)[] => {
  switch (metric) {
    case "tcpDownload":
      return ["bitsPerSecond", "retransmits"];
    case "tcpUpload":
      return ["bitsPerSecond"];
    case "udpDownload":
    case "udpUpload":
      return ["bitsPerSecond", "jitterMs", "lostPackets", "packetsReceived"];
    default:
      return [];
  }
};

/**
 * Heatmaps component - this is responsible for drawing all the heat maps
 * that are selected in the checkboxes
 * @returns the rendered heat maps
 */
export function Heatmaps() {
  const { settings, updateSettings } = useSettings();

  // array of surveyPoints passed in props
  const points = settings.surveyPoints;

  const [heatmaps, setHeatmaps] = useState<{ [key: string]: string | null }>(
    {},
  );
  const [selectedHeatmap, setSelectedHeatmap] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const [selectedMetrics, setSelectedMetrics] = useState<MeasurementTestType[]>(
    ["signalStrength"],
  );
  const [selectedProperties, setSelectedProperties] = useState<
    (keyof IperfTestProperty)[]
  >(["bitsPerSecond"]);

  const [showSignalStrengthAsPercentage, setShowSignalStrengthAsPercentage] =
    useState(true);

  // Test series comparison state
  const [compareSeriesIds, setCompareSeriesIds] = useState<string[]>([]);
  const [comparePointsMap, setComparePointsMap] = useState<
    Record<string, SurveyPoint[]>
  >({});
  const [overlayMode, setOverlayMode] = useState(false);

  // const r1 = calculateRadiusByDensity; // bad for small numbers of points
  const r2 = calculateRadiusByBoundingBox;
  // const r3 = calculateOptimalRadius; // bad for small numbers of points

  const displayedRadius = settings.radiusDivider // if settings value is non-null
    ? settings.radiusDivider // use it
    : Math.round(r2(points));

  const handleRadiusChange = (r: number) => {
    let savedVal: number | null = null;
    if (r != 0) {
      savedVal = r;
    }
    updateSettings({ radiusDivider: savedVal });
  };

  /**
   * getMetricValue - return the number for the metric and test type
   * for the designated point
   * @param point - the survey point
   * @param metric - name of the property to return
   * @param testType - if it's an iperf3 result, which one?
   * @returns number
   */
  const getMetricValue = useCallback(
    (
      point: SurveyPoint,
      metric: MeasurementTestType,
      testType?: keyof IperfTestProperty,
    ): number => {
      // console.log(`metric/testType: ${metric} ${testType}`);
      // console.log(`getMetricValue: ${JSON.stringify(point, null, 2)}`);
      switch (metric) {
        case "signalStrength": // data collection always captures both values
          return showSignalStrengthAsPercentage
            ? point.wifiData.signalStrength
            : point.wifiData.rssi;
        case "tcpDownload":
        case "tcpUpload":
        case "udpDownload":
        case "udpUpload":
          return testType
            ? point.iperfData[metric][testType] || 0
            : point.iperfData[metric].bitsPerSecond;
        default:
          return 0;
      }
    },
    [showSignalStrengthAsPercentage, settings.radiusDivider],
  );

  /**
   * generateHeatmapData - from the heatmap's points and criteria
   *   return an array of data points that are
   *   enabled, non-null and non-zero (if iperf results)
   * @param metric - which measurement
   * @param testType - which of the iperf3 test results
   * @returns array of {x, y, value}
   */
  const generateHeatmapData = useCallback(
    (
      metric: MeasurementTestType,
      testType?: keyof IperfTestProperty,
      sourcePoints?: SurveyPoint[],
    ) => {
      const dataPoints = sourcePoints ?? points;
      const data = dataPoints
        .filter((p) => p.isEnabled && p.hasMeasurement !== false)
        .map((point) => {
          let value = getMetricValue(point, metric, testType);
          switch (metric) {
            case "tcpDownload":
            case "tcpUpload":
            case "udpDownload":
            case "udpUpload":
              if (value == 0) return null;
              break;
            case "signalStrength":
              // always map the 0-100% signal strength (not rssi)
              value = point.wifiData.signalStrength;
          }
          return value !== null ? { x: point.x, y: point.y, value } : null;
        })
        .filter((value) => value !== null); // filter out any values that are null
      return data;
    },
    [points, getMetricValue],
  );

  const offScreenContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create an off-screen container for heatmap generation
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);
    offScreenContainerRef.current = container;

    return () => {
      if (offScreenContainerRef.current) {
        document.body.removeChild(offScreenContainerRef.current);
      }
    };
  }, []);

  const formatValue = useCallback(
    (
      value: number,
      metric: MeasurementTestType,
      testType?: keyof IperfTestProperty,
    ): string => {
      return metricFormatter(
        value,
        metric,
        testType,
        showSignalStrengthAsPercentage,
      );
    },
    [showSignalStrengthAsPercentage],
  );

  /**
   * drawColorBar - take the parameters and create the color gradient
   */
  function drawColorBar(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    x: number,
    y: number,
    min: number,
    max: number,
    metric: MeasurementTestType,
    testType: keyof IperfTestProperty,
  ) {
    const colorBarWidth = 50;
    const colorBarHeight = settings.dimensions.height;
    const colorBarX = settings.dimensions.width + 40;
    const colorBarY = 20;

    // create the gradient by sampling each element in the color bar
    for (let i = 0; i < colorBarHeight; i++) {
      const normalized = (colorBarHeight - i) / colorBarHeight;
      ctx.fillStyle = objectToRGBAString(
        getColorAt(normalized, settings.gradient),
      );
      ctx.fillRect(colorBarX, colorBarY + i, colorBarWidth, 1);
    }

    // define ticks and labels
    const numTicks = 10;
    ctx.fillStyle = "black";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";

    for (let i = 0; i <= numTicks; i++) {
      const y = colorBarY + (colorBarHeight * i) / numTicks;
      const value = max - ((max - min) * i) / numTicks;
      const label = formatValue(value, metric, testType);

      // Draw tick
      ctx.beginPath();
      ctx.moveTo(colorBarX, y);
      ctx.lineTo(colorBarX + 10, y);
      ctx.stroke();

      // Draw label
      ctx.fillText(label, colorBarX + colorBarWidth + 15, y + 5);
    }
  }

  /**
   * getHeatmapRange - scan the array and return the range
   * @param heatmapVals array of readings (number)
   * @param metric - kind of measurement
   * @param asPct - signalStrength as % or dBm
   * @returns both the min and max values
   */
  function getHeatmapRange(
    heatmapVals: number[],
    metric: MeasurementTestType,
    asPct: boolean,
  ): { min: number; max: number } {
    let min, max: number;
    if (metric == "signalStrength") {
      if (asPct) {
        max = 100;
        min = 0;
      } else {
        max = -40;
        min = -100;
      }
    } else {
      max = Math.max(...heatmapVals);
      min = Math.min(...heatmapVals);
    }
    return { min, max };
  }
  /**
   * renderHeatmap - top-level code to draw a single heat map
   *   including floor plan, scale on the side, and the heat map
   *   or diagnostic info about why it wasn't drawn
   * @param metric - signalStrength or one of the iperf3 tests
   * @param testType - which of the iperf3 tests
   * @returns none - result is that heat map has been drawn
   */
  const renderHeatmap = useCallback(
    (
      metric: MeasurementTestType,
      testType: keyof IperfTestProperty,
      sourcePoints?: SurveyPoint[],
      seriesName?: string,
    ): Promise<string | null> => {
      return (async () => {
        if (
          settings.dimensions.width === 0 ||
          settings.dimensions.height === 0 ||
          !offScreenContainerRef.current
        ) {
          logger.error(
            "Image dimensions not set or off-screen container not available",
          );
          return null;
        }

        const colorBarWidth = 50;
        const labelWidth = 150;
        const canvasRightPadding = 20;

        const outputCanvas = document.createElement("canvas");
        outputCanvas.width =
          settings.dimensions.width +
          colorBarWidth +
          labelWidth +
          canvasRightPadding;
        outputCanvas.height = settings.dimensions.height + 60;

        const ctx = outputCanvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          logger.error("Failed to get 2D context");
          return null;
        }

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

        // get an array of the enabled, non-null points to be plotted
        const heatmapData = generateHeatmapData(metric, testType, sourcePoints);
        const heatmapValues = heatmapData.map((p) => p.value);

        const { min, max } = getHeatmapRange(
          heatmapValues,
          metric,
          showSignalStrengthAsPercentage,
        );

        const glCanvas = document.createElement("canvas");
        glCanvas.width = settings.dimensions.width;
        glCanvas.height = settings.dimensions.height;

        const renderer = createHeatmapWebGLRenderer(
          glCanvas,
          heatmapData,
          settings.gradient,
        );
        await renderer.render({
          points: heatmapData,
          influenceRadius: settings.radiusDivider || displayedRadius,
          maxOpacity: settings.maxOpacity,
          minOpacity: settings.minOpacity,
          backgroundImageSrc: settings.floorplanImagePath,
          width: settings.dimensions.width,
          height: settings.dimensions.height,
        });

        ctx.drawImage(glCanvas, 0, 40);

        // Series title
        if (seriesName) {
          ctx.fillStyle = "black";
          ctx.font = "bold 18px Arial";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(seriesName, 10, 10);
        }

        if (!heatmapData || heatmapData.length === 0) {
          const lines = ["No heatmap:", `${metric} tests`, "not performed"];
          ctx.textAlign = "center";
          ctx.font = "72px sans-serif";

          let maxWidth = 0;
          let totalHeight = 0;
          const lineSpacing = 4;

          for (const line of lines) {
            const metrics = ctx.measureText(line);
            const lineHeight =
              metrics.actualBoundingBoxAscent +
              metrics.actualBoundingBoxDescent;
            maxWidth = Math.max(maxWidth, metrics.width);
            totalHeight += lineHeight + lineSpacing;
          }
          totalHeight += lineSpacing * 4;

          if (maxWidth > settings.dimensions.width * 0.9) {
            const optimalFontSize = (72 * settings.dimensions.width) / maxWidth;
            ctx.font = `${optimalFontSize}px sans-serif`;
          }

          ctx.fillStyle = "rgba(255, 255,255, 0.9)";
          ctx.fillRect(
            settings.dimensions.width / 2 - maxWidth / 2 + 5,
            (settings.dimensions.height * 2) / 3 - 72 + lineSpacing + 5,
            maxWidth,
            totalHeight,
          );

          ctx.fillStyle = "black";
          lines.forEach((line, index) => {
            ctx.fillText(
              line,
              settings.dimensions.width / 2,
              (settings.dimensions.height * 2) / 3 + index * 72,
            );
          });
        }

        drawColorBar(
          ctx,
          50,
          settings.dimensions.height,
          settings.dimensions.width + 40,
          40,
          min,
          max,
          metric,
          testType,
        );

        return outputCanvas.toDataURL();
      })();
    },
    [
      settings.dimensions,
      generateHeatmapData,
      settings.floorplanImagePath,
      settings,
    ],
  );

  const generateAllHeatmaps = useCallback(async () => {
    const newHeatmaps: { [key: string]: string | null } = {};

    // Current series heatmaps
    for (const metric of selectedMetrics) {
      if (metric === "signalStrength") {
        newHeatmaps[metric] = await renderHeatmap(
          metric,
          "signalStrength",
          undefined,
          settings.series.find((s) => s.id === settings.currentSeriesId)?.name,
        );
      } else {
        const availableProperties = getAvailableProperties(metric);
        for (const testType of selectedProperties) {
          if (availableProperties.includes(testType)) {
            const heatmapData = generateHeatmapData(metric, testType);
            if (heatmapData) {
              newHeatmaps[`${metric}-${testType}`] = await renderHeatmap(
                metric,
                testType,
                undefined,
                settings.series.find((s) => s.id === settings.currentSeriesId)
                  ?.name,
              );
            }
          }
        }
      }
    }

    // Comparison series heatmaps
    for (const compareSeriesId of compareSeriesIds) {
      const comparePoints = comparePointsMap[compareSeriesId];
      if (!comparePoints) continue;
      const compareSeriesName =
        settings.series.find((s) => s.id === compareSeriesId)?.name || compareSeriesId;

      for (const metric of selectedMetrics) {
        if (metric === "signalStrength") {
          newHeatmaps[`${metric}-${compareSeriesId}`] = await renderHeatmap(
            metric,
            "signalStrength",
            comparePoints,
            compareSeriesName,
          );
        } else {
          const availableProperties = getAvailableProperties(metric);
          for (const testType of selectedProperties) {
            if (availableProperties.includes(testType)) {
              const heatmapData = generateHeatmapData(
                metric,
                testType,
                comparePoints,
              );
              if (heatmapData) {
                newHeatmaps[`${metric}-${testType}-${compareSeriesId}`] =
                  await renderHeatmap(
                    metric,
                    testType,
                    comparePoints,
                    compareSeriesName,
                  );
              }
            }
          }
        }
      }
    }

    setHeatmaps(newHeatmaps);
  }, [
    renderHeatmap,
    selectedMetrics,
    selectedProperties,
    generateHeatmapData,
    compareSeriesIds,
    comparePointsMap,
    settings.series,
    settings.currentSeriesId,
  ]);

  const openHeatmapModal = (src: string, alt: string) => {
    setSelectedHeatmap({ src, alt });
  };

  const closeHeatmapModal = () => {
    setSelectedHeatmap(null);
  };

  useEffect(() => {
    if (settings.dimensions.width > 0 && settings.dimensions.height > 0) {
      generateAllHeatmaps();
    }
  }, [
    settings.dimensions,
    generateAllHeatmaps,
    points,
    selectedMetrics,
    selectedProperties,
    showSignalStrengthAsPercentage,
    compareSeriesIds,
    comparePointsMap,
  ]);

  // Load comparison series points when selected
  useEffect(() => {
    async function loadComparisonSeries() {
      const newMap: Record<string, SurveyPoint[]> = {};
      for (const seriesId of compareSeriesIds) {
        try {
          const response = await fetch(
            `/api/settings?name=${encodeURIComponent(
              settings.floorplanImageName,
            )}&seriesId=${encodeURIComponent(seriesId)}`,
          );
          if (response.ok) {
            const data = await response.json();
            newMap[seriesId] = data.surveyPoints || [];
          }
        } catch (err) {
          logger.error(`Failed to load comparison series ${seriesId}: ${err}`);
        }
      }
      setComparePointsMap(newMap);
    }

    if (compareSeriesIds.length > 0) {
      loadComparisonSeries();
    } else {
      setComparePointsMap({});
    }
  }, [compareSeriesIds, settings.floorplanImageName]);

  const toggleMetric = (metric: MeasurementTestType) => {
    setSelectedMetrics((prev) => {
      const newMetrics = prev.includes(metric)
        ? prev.filter((m) => m !== metric)
        : [...prev, metric];
      return newMetrics.sort(
        (a, b) =>
          Object.values(testTypes).indexOf(a) -
          Object.values(testTypes).indexOf(b),
      );
    });
  };

  const toggleProperty = (property: keyof IperfTestProperty) => {
    setSelectedProperties((prev) => {
      const newProperties = prev.includes(property)
        ? prev.filter((p) => p !== property)
        : [...prev, property];
      return newProperties.sort(
        (a, b) =>
          Object.values(testProperties).indexOf(a) -
          Object.values(testProperties).indexOf(b),
      );
    });
  };

  const toggleCompareSeries = (seriesId: string) => {
    setCompareSeriesIds((prev) =>
      prev.includes(seriesId)
        ? prev.filter((id) => id !== seriesId)
        : [...prev, seriesId],
    );
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Heatmaps</h2>

      <div className="mb-4">
        <h3 className="text-lg font-medium mb-2 text-gray-700">
          Select Metrics
        </h3>
        <div className="flex flex-wrap gap-4">
          {Object.values(testTypes).map((metric) => (
            <div key={metric} className="flex items-center space-x-2">
              <Checkbox
                id={`metric-${metric}`}
                checked={selectedMetrics.includes(metric)}
                onCheckedChange={() => toggleMetric(metric)}
              />
              <label
                htmlFor={`metric-${metric}`}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {metricTitles[metric]}
              </label>
            </div>
          ))}
        </div>
      </div>

      {settings.series.length > 1 && (
        <div className="mb-4">
          <h3 className="text-lg font-medium mb-2 text-gray-700">
            Show series
          </h3>
          <div className="flex flex-wrap gap-4">
            {settings.series
              .filter((s) => s.id !== settings.currentSeriesId)
              .map((s) => (
                <div key={s.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`compare-${s.id}`}
                    checked={compareSeriesIds.includes(s.id)}
                    onCheckedChange={() => toggleCompareSeries(s.id)}
                  />
                  <label
                    htmlFor={`compare-${s.id}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {s.name}
                  </label>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2 text-gray-700">
          Select Properties
        </h3>
        <div className="flex flex-wrap gap-4">
          {Object.values(testProperties)
            .filter((property) => property != "signalStrength")
            .map((property) => (
              <div key={property} className="flex items-center space-x-2">
                <Checkbox
                  id={`property-${property}`}
                  checked={selectedProperties.includes(property)}
                  onCheckedChange={() => toggleProperty(property)}
                />
                <label
                  htmlFor={`property-${property}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {propertyTitles[property]}
                </label>
              </div>
            ))}
        </div>
      </div>

      <HeatmapSlider value={displayedRadius} onChange={handleRadiusChange} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {selectedMetrics.map((metric) => (
          <div key={metric} className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-medium mb-3 text-gray-700">
              {metricTitles[metric]}
            </h3>
            {metric === "signalStrength" ? (
              <div className="grid grid-cols-2 gap-4">
                {heatmaps[metric] && (
                  <div>
                    <p className="text-sm font-semibold text-gray-600 mb-1">
                      {settings.series.find((s) => s.id === settings.currentSeriesId)?.name || "Current"}
                    </p>
                    <HeatmapImage
                      src={heatmaps[metric]}
                      alt={`Heatmap for ${metricTitles[metric]}`}
                      onClick={() =>
                        openHeatmapModal(
                          heatmaps[metric]!,
                          `Heatmap for ${metricTitles[metric]}`,
                        )
                      }
                    />
                  </div>
                )}
                {compareSeriesIds.map((seriesId) => {
                  const heatmap = heatmaps[`${metric}-${seriesId}`];
                  const seriesName = settings.series.find((s) => s.id === seriesId)?.name || seriesId;
                  if (!heatmap) return null;
                  return (
                    <div key={`${metric}-${seriesId}`}>
                      <p className="text-sm font-semibold text-gray-600 mb-1">{seriesName}</p>
                      <HeatmapImage
                        src={heatmap}
                        alt={`Heatmap for ${metricTitles[metric]} - ${seriesName}`}
                        onClick={() => openHeatmapModal(heatmap, seriesName)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {selectedProperties.map((testType) => {
                  const currentHeatmap = heatmaps[`${metric}-${testType}`];
                  const entries: { key: string; src: string | null; alt: string }[] = [];
                  if (currentHeatmap) {
                    entries.push({
                      key: `${metric}-${testType}`,
                      src: currentHeatmap,
                      alt: `Heatmap for ${metricTitles[metric]} - ${propertyTitles[testType]}`,
                    });
                  }
                  for (const seriesId of compareSeriesIds) {
                    const compareHeatmap = heatmaps[`${metric}-${testType}-${seriesId}`];
                    if (compareHeatmap) {
                      entries.push({
                        key: `${metric}-${testType}-${seriesId}`,
                        src: compareHeatmap,
                        alt: `Heatmap for ${metricTitles[metric]} - ${propertyTitles[testType]} - comparison`,
                      });
                    }
                  }

                  return entries.map(({ key, src, alt }) => (
                    <div key={key}>
                      <h4 className="text-sm font-medium mb-2 text-gray-600">
                        {propertyTitles[testType]}
                      </h4>
                      <HeatmapImage
                        src={src}
                        alt={alt}
                        onClick={() => openHeatmapModal(src, alt)}
                      />
                    </div>
                  ));
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <HeatmapModal
        src={selectedHeatmap?.src ?? ""}
        alt={selectedHeatmap?.alt ?? ""}
        open={selectedHeatmap !== null}
        onClose={closeHeatmapModal}
      />
    </div>
  );
}
