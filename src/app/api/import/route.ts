/**
 * /api/import
 * POST /api/import
 * Imports a survey exported via /api/export. The payload contains the
 * settings and a base64-encoded floorplan image. Both are restored on the
 * server.
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rename } from "fs/promises";
import path from "path";
import { sanitizeFilename } from "@/lib/utils";

const SURVEYS_DIR = path.join(process.cwd(), "data", "surveys");
const MEDIA_DIR = path.join(process.cwd(), "public", "media");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 },
      );
    }

    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON file" },
        { status: 400 },
      );
    }

    if (!payload.floorplanImageName || !payload.settings) {
      return NextResponse.json(
        { error: "Invalid export file: missing floorplanImageName or settings" },
        { status: 400 },
      );
    }

    const name: string = payload.floorplanImageName;
    const safeName = sanitizeFilename(name);

    await mkdir(SURVEYS_DIR, { recursive: true });
    await mkdir(MEDIA_DIR, { recursive: true });

    // Strip sensitive data before saving settings
    const { sudoerPassword: _, ...safeSettings } = payload.settings;

    const surveyPath = path.join(SURVEYS_DIR, `${safeName}.json`);
    const surveyTempPath = `${surveyPath}.tmp`;
    await writeFile(surveyTempPath, JSON.stringify(safeSettings, null, 2));
    await rename(surveyTempPath, surveyPath);

    // Restore floorplan image if present
    if (payload.imageBase64) {
      const imageBuffer = Buffer.from(payload.imageBase64, "base64");
      const mediaPath = path.join(MEDIA_DIR, name);
      const mediaTempPath = `${mediaPath}.tmp`;
      await writeFile(mediaTempPath, imageBuffer);
      await rename(mediaTempPath, mediaPath);
    }

    return NextResponse.json({
      status: "success",
      floorplanImageName: name,
      path: surveyPath,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Unable to import survey: ${err}` },
      { status: 500 },
    );
  }
}
