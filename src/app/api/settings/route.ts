/**
 * /api/settings API
 * GET /api/settings?name=<floorplan-name>&seriesId=<id> - reads settings for a floorplan series
 * POST /api/settings - writes settings to a file
 * GET /api/settings?list=true - lists all available survey files
 * GET /api/settings?list=true&name=<floorplan-name> - lists all series for a floorplan
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, readdir, rename, copyFile, unlink } from "fs/promises";
import path from "path";
import { sanitizeFilename } from "@/lib/utils";

const SURVEYS_DIR = path.join(process.cwd(), "data", "surveys");

/**
 * Get the full path for a survey file.
 * If a seriesId is provided, the file name includes the series id.
 * The default series keeps the original file name for backward compatibility.
 */
function getSurveyPath(floorplanName: string, seriesId?: string | null): string {
  const sanitized = sanitizeFilename(floorplanName);
  if (!seriesId || seriesId === "default") {
    return path.join(SURVEYS_DIR, `${sanitized}.json`);
  }
  const sanitizedSeries = sanitizeFilename(seriesId);
  return path.join(SURVEYS_DIR, `${sanitized}.${sanitizedSeries}.json`);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const listAll = searchParams.get("list");
  const name = searchParams.get("name");
  const seriesId = searchParams.get("seriesId");

  // List all survey files (or series for a given floorplan)
  if (listAll === "true") {
    try {
      await mkdir(SURVEYS_DIR, { recursive: true });
      const files = await readdir(SURVEYS_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      if (!name) {
        return NextResponse.json({ surveys: jsonFiles.map((f) => f.replace(".json", "")) });
      }

      const sanitized = sanitizeFilename(name);
      const seriesFiles = jsonFiles.filter((f) => {
        const base = f.replace(".json", "");
        return base === sanitized || base.startsWith(`${sanitized}.`);
      });

      return NextResponse.json({ surveys: seriesFiles.map((f) => f.replace(".json", "")) });
    } catch (err) {
      return NextResponse.json(
        { error: `Unable to list surveys: ${err}` },
        { status: 500 },
      );
    }
  }

  // Read a specific survey file
  if (!name) {
    return NextResponse.json(
      { error: "Missing 'name' query parameter" },
      { status: 400 },
    );
  }

  try {
    const filePath = getSurveyPath(name, seriesId);
    const data = await readFile(filePath, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return NextResponse.json({ error: "Survey not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Unable to read survey: ${err}` },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const settings = await request.json();

    if (!settings.floorplanImageName) {
      return NextResponse.json(
        { error: "Missing floorplanImageName in settings" },
        { status: 400 },
      );
    }

    // Ensure surveys directory exists
    await mkdir(SURVEYS_DIR, { recursive: true });

    // Remove sensitive data before saving
    const { sudoerPassword: _, ...safeSettings } = settings;

    const filePath = getSurveyPath(
      settings.floorplanImageName,
      settings.currentSeriesId,
    );

    // Try atomic write via temp file + rename; fall back to direct write if rename fails.
    const tempPath = `${filePath}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(safeSettings, null, 2));
      await rename(tempPath, filePath);
    } catch (renameErr) {
      // Fallback: write directly to target file (less atomic but more compatible)
      await writeFile(filePath, JSON.stringify(safeSettings, null, 2));
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup error
      }
    }

    return NextResponse.json({ status: "success", path: filePath });
  } catch (err) {
    return NextResponse.json(
      { error: `Unable to save survey: ${err}` },
      { status: 500 },
    );
  }
}
