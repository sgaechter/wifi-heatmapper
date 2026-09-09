/**
 * /api/export
 * GET /api/export?name=<floorplan-name>
 * Exports a survey as a single JSON file containing the settings and the
 * base64-encoded floorplan image so it can be imported into another instance.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { sanitizeFilename } from "@/lib/utils";

const SURVEYS_DIR = path.join(process.cwd(), "data", "surveys");
const MEDIA_DIR = path.join(process.cwd(), "public", "media");

function getSurveyPath(floorplanName: string): string {
  return path.join(SURVEYS_DIR, `${sanitizeFilename(floorplanName)}.json`);
}

function getMediaPath(floorplanName: string): string {
  return path.join(MEDIA_DIR, floorplanName);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name");

  if (!name) {
    return NextResponse.json(
      { error: "Missing 'name' query parameter" },
      { status: 400 },
    );
  }

  try {
    const surveyPath = getSurveyPath(name);
    const surveyRaw = await readFile(surveyPath, "utf-8");
    let surveyData;
    try {
      surveyData = JSON.parse(surveyRaw);
    } catch (parseErr) {
      return NextResponse.json(
        { error: `Survey file is not valid JSON: ${parseErr}` },
        { status: 500 },
      );
    }

    const mediaPath = getMediaPath(name);
    let imageBase64 = "";
    let imageMime = "image/png";
    try {
      const imageBuffer = await readFile(mediaPath);
      imageBase64 = imageBuffer.toString("base64");
      const ext = path.extname(name).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg") imageMime = "image/jpeg";
      else if (ext === ".png") imageMime = "image/png";
      else if (ext === ".gif") imageMime = "image/gif";
      else if (ext === ".webp") imageMime = "image/webp";
    } catch {
      // Floorplan image not found - export without it
    }

    const exportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      floorplanImageName: name,
      imageMime,
      imageBase64,
      settings: surveyData,
    };

    // Use the original floorplan name as the base for the export filename
    const fileName = `${name}.wifiheatmap.json`;
    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Unable to export survey: ${err}` },
      { status: 500 },
    );
  }
}
