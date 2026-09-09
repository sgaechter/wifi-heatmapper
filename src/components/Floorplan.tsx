import React, { ReactNode, useRef, useState } from "react";
import { useEffect } from "react";
import {
  delay,
  rssiToPercentage,
} from "../lib/utils";
import { getColorAt, objectToRGBAString } from "@/lib/utils-gradient";
import { useSettings } from "./GlobalSettings";
import { HeatmapSettings, SurveyResult, SurveyPoint } from "../lib/types";
import NewToast from "@/components/NewToast";
import PopupDetails from "@/components/PopupDetails";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLogger } from "../lib/logger";
const logger = getLogger("Floorplan");

export default function ClickableFloorplan(): ReactNode {
  const { settings, updateSettings, surveyPointActions, createTestSeries, switchTestSeries } = useSettings();

  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedPoint, setSelectedPoint] = useState<SurveyPoint | null>(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  // const [dimensions, setDimensions] = useState(settings.dimensions);
  const [scale, setScale] = useState(1);
  const [alertMessage, setAlertMessage] = useState("");
  const [isToastOpen, setIsToastOpen] = useState(false);
  const [surveyClick, setSurveyClick] = useState({ x: 0, y: 0 });
  const remeasurePointId = useRef<string | undefined>(undefined);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    point: SurveyPoint | null;
  }>({ visible: false, x: 0, y: 0, point: null });

  // Rename dialog state
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    point: SurveyPoint | null;
    newName: string;
  }>({ open: false, point: null, newName: "" });

  // New test series dialog state
  const [newSeriesDialog, setNewSeriesDialog] = useState<{
    open: boolean;
    name: string;
  }>({ open: false, name: "" });

  /**
   * Load the image (and the canvas) when the component is mounted
   */
  useEffect(() => {
    if (settings.floorplanImagePath != "") {
      const img = new Image();
      img.src = settings.floorplanImagePath; // load the image from the path

      img.onload = () => {
        const newDimensions = { width: img.width, height: img.height };
        updateSettings({ dimensions: newDimensions });
        setImageLoaded(true);
        imageRef.current = img;
      };
      img.onerror = () => {
        console.log(`image error`);
      };
    }
  }, []);

  useEffect(() => {
    if (imageLoaded && canvasRef.current) {
      const canvas = canvasRef.current;
      const containerWidth = containerRef.current?.clientWidth || canvas.width;
      const scaleX = containerWidth / settings.dimensions.width;
      setScale(scaleX);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      drawCanvas();
    }
  }, [imageLoaded, settings.dimensions, settings.surveyPoints]);

  const handleToastIsReady = (): void => {
    measureSurveyPoint(surveyClick, remeasurePointId.current);
    remeasurePointId.current = undefined;
  };

  /**
   * measureSurveyPoint - make measurements for point at x/y.
   * If existingPointId is provided, the existing point is updated in place
   * (used by "Re-measure" from the context menu). Otherwise a new point is added.
   */
  const measureSurveyPoint = async (
    surveyClick: { x: number; y: number },
    existingPointId?: string,
  ) => {
    const x = Math.round(surveyClick.x);
    const y = Math.round(surveyClick.y);
    let result: SurveyResult = { state: "pending" };

    // an object with a single property: settings
    const partialSettings = {
      settings: {
        iperfServerAdrs: settings.iperfServerAdrs,
        testDuration: settings.testDuration,
        sudoerPassword: settings.sudoerPassword,
        // ignoredSSIDs: settings.ignoredSSIDs,
        // sameSSID: settings.sameSSID,
      },
    };
    // Kick off the measurement process by calling "action=start"
    // This returns immediately, then poll for data
    const res = await fetch("/api/start-task?action=start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partialSettings),
    });
    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const startTime = Date.now();
    while (true) {
      try {
        const res = await fetch("/api/start-task?action=results");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result = await res.json();
        logger.debug(`Status is: ${JSON.stringify(result)}`);
        if (result.state != "pending") {
          // got a result - status is "done" or "error"
          break;
        }
      } catch (err) {
        // Typical: handle network errors, aborts, etc.
        console.error(`Measurement process gave error: ${err}`);
      }
      await delay(1000); // ask again in one second
    }
    console.log(`Measurement took ${Date.now() - startTime} ms`);

    if (result.state === "error") {
      cleanupFailedTest(`${result.explanation}`);
      return;
    }
    if (!result.results!.wifiData || !result.results!.iperfData) {
      cleanupFailedTest("Measurement cancelled");
      return;
    }
    const { wifiData, iperfData } = result.results!;

    if (existingPointId) {
      // Update existing point, preserving its ID and position
      const existingPoint = settings.surveyPoints.find(
        (p) => p.id === existingPointId,
      );
      if (existingPoint) {
        surveyPointActions.update(existingPoint, {
          wifiData,
          iperfData,
          timestamp: Date.now(),
          isEnabled: true,
          hasMeasurement: true,
        });
      }
    } else {
      // Got measurements: add the x/y point, point number, and enabled
      const newPoint = {
        wifiData,
        iperfData,
        x,
        y,
        timestamp: Date.now(),
        isEnabled: true,
        id: `Point_${settings.nextPointNum}`,
      };
      addSurveyPoint(newPoint, x, y, settings);
    }
  };

  /**
   * cleanupFailedTest() - if something went wrong during the measurement,
   *   close NewToast
   *   remove the empty survey point by re-drawing the canvas
   *     (without the prospective empty survey point)
   *   set the proper alert message
   * @param errorMessage Message to reuturn
   * @returns void
   */
  function cleanupFailedTest(errorMessage: string): void {
    setIsToastOpen(false);
    drawCanvas(); // restore the points on the canvas (not the empty point)
    setAlertMessage(errorMessage);
    return;
  }

  function addSurveyPoint(
    newPoint: SurveyPoint,
    x: number,
    y: number,
    settings: HeatmapSettings,
  ): void {
    // otherwise, add the point, bumping the point number
    const pointNum = settings.nextPointNum;
    const addedPoint: SurveyPoint = {
      ...newPoint,
      x,
      y,
      isEnabled: true,
      id: `Point_${pointNum}`,
      seriesId: settings.currentSeriesId,
      hasMeasurement: true,
    };
    updateSettings({ nextPointNum: pointNum + 1 });
    surveyPointActions.add(addedPoint);
  }

  /**
   * drawCanvas - make the entire drawing go...
   */
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas && imageRef.current) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // draw the image "behind" everything else
        ctx.drawImage(imageRef.current, 0, 0);
        // draw the points on top
        drawPoints(settings.surveyPoints, ctx);
      }
    }
  };

  /**
   * Close the popup window by setting selectedPoint to null
   */
  const closePopup = (): void => {
    setSelectedPoint(null);
  };

  /**
   * Create a new test series from the current survey points.
   */
  const handleCreateNewSeries = () => {
    const name = newSeriesDialog.name.trim();
    if (!name) return;
    createTestSeries(name);
    setNewSeriesDialog({ open: false, name: "" });
  };

  /**
   * Show the browser-native context menu for a survey point.
   * Prevents the default menu and positions our custom menu.
   */
  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(event);
    const point = findNearbyPoint(x, y);

    if (point) {
      event.preventDefault();
      setSelectedPoint(point);
      setContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        point,
      });
    }
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  /**
   * Remeasure an existing point: keep its ID and position but run a new measurement.
   */
  const handleRemeasurePoint = (point: SurveyPoint) => {
    closeContextMenu();
    setSelectedPoint(null);
    remeasurePointId.current = point.id;
    setSurveyClick({ x: point.x, y: point.y });
    setAlertMessage("");
    setIsToastOpen(true);
  };

  /**
   * Delete a point via the context menu.
   */
  const handleDeletePoint = (point: SurveyPoint) => {
    closeContextMenu();
    setSelectedPoint(null);
    surveyPointActions.delete([point]);
  };

  /**
   * Toggle a point's enabled state via the context menu.
   */
  const handleToggleEnabled = (point: SurveyPoint) => {
    closeContextMenu();
    surveyPointActions.update(point, { isEnabled: !point.isEnabled });
  };

  /**
   * Open the rename dialog for a point.
   */
  const handleRenameClick = (point: SurveyPoint) => {
    setRenameDialog({
      open: true,
      point,
      newName: point.id,
    });
    closeContextMenu();
  };

  const confirmRename = () => {
    if (renameDialog.point && renameDialog.newName.trim()) {
      surveyPointActions.update(renameDialog.point, {
        id: renameDialog.newName.trim(),
      });
    }
    setRenameDialog({ open: false, point: null, newName: "" });
  };
  /**
   * drawPoints - draw the list of points in the specified context
   * @param ctx
   * @param points
   */
  const drawPoints = (points: SurveyPoint[], ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    points.forEach((point) => drawPoint(point, ctx, { bgW: canvas!.width }));
  };

  type ScaleOpts = {
    bgW: number; // background width in CSS px
    crisp1px?: boolean; // keep borders at ~1px regardless of scale
    dpr?: number; // pass window.devicePixelRatio
  };

  function drawPoint(
    point: SurveyPoint,
    ctx: CanvasRenderingContext2D,
    opts: ScaleOpts,
  ) {
    if (!point.wifiData && point.hasMeasurement !== false) return;

    const { bgW, crisp1px = true, dpr = window.devicePixelRatio || 1 } = opts;

    // All sizes derived from bg width
    const R = 0.008 * bgW; // marker radius = 0.8% of bg width
    const BORDER = crisp1px ? 1 / dpr : 0.002 * bgW; // ~1px or 0.2% of bg width
    const FONT = 0.012 * bgW; // 1.2% of bg width
    const LINE_H = 1.2 * FONT;
    const PAD = 0.004 * bgW;
    const LABEL_OFFSET_Y = 0.015 * bgW;
    const SHADOW_BLUR = 0.004 * bgW;
    const SHADOW_OFF = 0.002 * bgW;

    const wifiInfo = point.wifiData;
    const isPlaceholder = point.hasMeasurement === false;

    // Main point
    ctx.beginPath();
    ctx.arc(point.x, point.y, R, 0, 2 * Math.PI);
    if (isPlaceholder) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    } else {
      ctx.fillStyle = point.isEnabled
        ? objectToRGBAString(
            getColorAt(rssiToPercentage(wifiInfo.rssi) / 100, settings.gradient),
          )
        : "rgba(156, 163, 175, 0.9)";
    }
    ctx.fill();

    // Border
    ctx.strokeStyle = "grey";
    ctx.lineWidth = BORDER;
    ctx.closePath();
    ctx.stroke();

    // Annotation
    const annotation = isPlaceholder ? "no data" : `${wifiInfo.signalStrength}%`;
    ctx.font = `${FONT}px Arial`;
    const lines = annotation.split("\n");
    const boxWidth =
      Math.max(...lines.map((line) => ctx.measureText(line).width)) + PAD * 2;
    const boxHeight = lines.length * LINE_H + PAD * 2;

    // Shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = SHADOW_BLUR;
    ctx.shadowOffsetX = SHADOW_OFF;
    ctx.shadowOffsetY = SHADOW_OFF;

    // Label box
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillRect(
      point.x - boxWidth / 2,
      point.y + LABEL_OFFSET_Y,
      boxWidth,
      boxHeight,
    );

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Text
    ctx.fillStyle = "#1F2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, point.x, point.y + LABEL_OFFSET_Y + PAD + i * LINE_H);
    });
  }

  /**
   * drawEmptyPoint() - draw an empty point, grey boundary to be filled
   *   in when the data returns.
   * @param point
   * @param ctx
   * @param opts
   */
  function drawEmptyPoint(
    point: SurveyPoint,
    ctx: CanvasRenderingContext2D,
    opts: ScaleOpts,
  ) {
    const { R, BORDER } = sizesFrom(opts);

    // ensure no inherited shadows
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.arc(point.x, point.y, R, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "grey";
    ctx.lineWidth = BORDER;
    ctx.stroke();
  }

  function sizesFrom(opts: ScaleOpts) {
    const dpr = opts.dpr ?? (window.devicePixelRatio || 1);
    return {
      R: 0.008 * opts.bgW,
      BORDER: (opts.crisp1px ?? true) ? 1 / dpr : 0.002 * opts.bgW,
    };
  }

  /**
   * getCanvasCoordinates - convert a mouse/client position to canvas
   * logical coordinates (accounting for the responsive CSS scaling).
   */
  const getCanvasCoordinates = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };

  /**
   * findNearbyPoint - return the first survey point within the
   * interaction radius of the given canvas coordinates, or undefined.
   */
  const findNearbyPoint = (x: number, y: number): SurveyPoint | undefined => {
    return settings.surveyPoints.find(
      (point) => Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2) < 20,
    );
  };

  /**
   * handleCanvasMouseMove - show the popup when hovering over a point,
   * hide it when the cursor leaves the interaction radius.
   */
  const handleCanvasMouseMove = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    const { x, y } = getCanvasCoordinates(event);
    const hoveredPoint = findNearbyPoint(x, y);

    if (hoveredPoint) {
      setSelectedPoint(hoveredPoint);
      setPopupPosition({
        x: hoveredPoint.x * scale,
        y: hoveredPoint.y * scale,
      });
    } else if (selectedPoint) {
      setSelectedPoint(null);
    }
  };

  /**
   * handleCanvasClick - start a new measurement at the clicked position.
   * Existing points are inspected on hover, so a click always starts a new
   * measurement here.
   */
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(event);
    setSurveyClick({ x, y }); // retain the X/Y of the clicked point

    // start a measurement
    drawEmptyPoint(
      { x, y } as SurveyPoint,
      event.currentTarget.getContext("2d")!,
      {
        bgW: event.currentTarget!.width,
      },
    );
    setSelectedPoint(null);
    setAlertMessage("");
    setIsToastOpen(true);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-gray-800">
        Interactive Floorplan
      </h2>
      <div className="p-2 rounded-md text-sm">
        <p>Click on the floor plan to start a new measurement.</p>
        <p>Hover over existing points to see the measurement details.</p>

        <div className="space-y-2 flex flex-col">
          {settings.surveyPoints?.length > 0 && (
            <div>Total Measurements: {settings.surveyPoints.length}</div>
          )}
          {settings.series.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm">Series:</span>
              <select
                className="border border-gray-200 rounded-sm p-1 text-sm"
                value={settings.currentSeriesId}
                onChange={(e) => switchTestSeries(e.target.value)}
              >
                {settings.series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      {alertMessage != "" && (
        <Alert variant="destructive">
          <AlertTitle>Error Summary</AlertTitle>
          <AlertDescription>{alertMessage}</AlertDescription>
        </Alert>
      )}
      <div className="relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={settings.dimensions.width}
          height={settings.dimensions.height}
          onClick={handleCanvasClick}
          onContextMenu={handleContextMenu}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setSelectedPoint(null)}
          className="border border-gray-300 rounded-lg cursor-pointer"
        />

        <div
          style={{
            position: "absolute",
            left: `${popupPosition.x}px`,
            top: `${popupPosition.y}px`,
            transform: "translate(10px, -50%)",
          }}
        >
          <PopupDetails
            point={selectedPoint}
            settings={settings}
            surveyPointActions={surveyPointActions}
            onClose={closePopup}
          />
        </div>

        {isToastOpen && (
          <NewToast
            onClose={() => setIsToastOpen(false)}
            toastIsReady={handleToastIsReady}
          />
        )}

        {/* Custom context menu for survey points */}
        {contextMenu.visible && contextMenu.point && (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-1 text-xs text-gray-500 border-b border-gray-100 truncate">
              {contextMenu.point.id}
            </div>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              onClick={() => handleRemeasurePoint(contextMenu.point!)}
            >
              Re-measure point
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              onClick={() => handleRenameClick(contextMenu.point!)}
            >
              Rename point
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              onClick={() => handleToggleEnabled(contextMenu.point!)}
            >
              {contextMenu.point!.isEnabled ? "Deactivate" : "Activate"} point
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={() => handleDeletePoint(contextMenu.point!)}
            >
              Delete point
            </button>
          </div>
        )}

        {/* Click outside / scroll closes context menu */}
        {contextMenu.visible && (
          <div
            className="fixed inset-0 z-40"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
        )}

        {/* Rename dialog */}
        <Dialog
          open={renameDialog.open}
          onOpenChange={(open) => {
            if (!open) setRenameDialog({ open: false, point: null, newName: "" });
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename measurement point</DialogTitle>
              <DialogDescription>
                Enter a new display name for {renameDialog.point?.id}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="pointName">Name</Label>
                <Input
                  id="pointName"
                  value={renameDialog.newName}
                  onChange={(e) =>
                    setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))
                  }
                  placeholder="Point name"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  setRenameDialog({ open: false, point: null, newName: "" })
                }
              >
                Cancel
              </Button>
              <Button onClick={confirmRename}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewSeriesDialog({ open: true, name: "" })}
            disabled={settings.surveyPoints.length === 0}
          >
            New test series
          </Button>
        </div>

        {/* New test series dialog */}
        <Dialog
          open={newSeriesDialog.open}
          onOpenChange={(open) => {
            if (!open) setNewSeriesDialog({ open: false, name: "" });
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new test series</DialogTitle>
              <DialogDescription>
                Enter a name for the new measurement series. The positions of the
                current points will be copied as placeholders.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="seriesName">Series name</Label>
                <Input
                  id="seriesName"
                  value={newSeriesDialog.name}
                  onChange={(e) =>
                    setNewSeriesDialog((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. before WiFi optimization"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setNewSeriesDialog({ open: false, name: "" })}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateNewSeries}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
