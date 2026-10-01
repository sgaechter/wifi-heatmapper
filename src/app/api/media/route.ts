// app/api/media/route.ts
/**
 * /media API
 * GET /media returns a list of the files in the /public/media directory
 * POST /media ... uploads a file
 */
import { NextResponse } from "next/server";
import { readdir, writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { sanitizeFilename } from "@/lib/utils";

const execFileAsync = promisify(execFile);

const PDF_DPI = 150;

// Ensure body parsing is disabled so we can handle file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

const MEDIA_DIR = path.join(process.cwd(), "public", "media");

/**
 * Detect the PDF conversion tool available on the system.
 * Prefers pdftoppm (poppler) as it is widely available and produces high-quality PNGs.
 */
type PdfConverter = {
  command: string;
  args: (input: string, output: string) => string[];
};

async function findPdfConverter(): Promise<PdfConverter> {
  // Prefer pdftoppm from Poppler (usually in PATH on Linux/macOS; may need manual install on Windows)
  try {
    await execFileAsync("pdftoppm", ["-v"]);
    return {
      command: "pdftoppm",
      args: (input, output) => [
        "-png",
        "-singlefile",
        "-r",
        `${PDF_DPI}`,
        input,
        output,
      ],
    };
  } catch {
    // Fallback to pdftocairo (also from Poppler)
    try {
      await execFileAsync("pdftocairo", ["-v"]);
      return {
        command: "pdftocairo",
        args: (input, output) => ["-png", "-r", `${PDF_DPI}`, input, output],
      };
    } catch {
      throw new Error(
        "No PDF converter found. Please install Poppler (pdftoppm or pdftocairo) and ensure it is in PATH.",
      );
    }
  }
}

/**
 * Convert the first page of a PDF to a PNG file.
 * Returns the path of the generated PNG.
 */
async function convertPdfToPng(pdfPath: string): Promise<string> {
  const converter = await findPdfConverter();
  const outputPrefix = pdfPath.replace(/\.pdf$/i, "");

  await execFileAsync(converter.command, converter.args(pdfPath, outputPrefix));

  // pdftoppm with -singlefile appends .png automatically; pdftocairo does the same.
  const pngPath = `${outputPrefix}.png`;
  return pngPath;
}

export async function GET() {
  try {
    await mkdir(MEDIA_DIR, { recursive: true });
    const files = await readdir(MEDIA_DIR);
    const imageFiles = files.filter((name) => /\.(jpe?g|png)$/i.test(name));
    return NextResponse.json({ files: imageFiles });
  } catch (err) {
    return NextResponse.json(
      { error: `Unable to list files ${err}` },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await mkdir(MEDIA_DIR, { recursive: true });

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file || typeof file.name !== "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const originalName = sanitizeFilename(file.name);
    const isPdf = /\.pdf$/i.test(originalName);

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalPath = path.join(MEDIA_DIR, originalName);

    await writeFile(originalPath, buffer);

    if (isPdf) {
      try {
        const pngPath = await convertPdfToPng(originalPath);
        // Remove the uploaded PDF, keeping only the generated PNG.
        await unlink(originalPath);
        const pngName = path.basename(pngPath);
        return NextResponse.json({ status: "success", name: pngName });
      } catch (convertErr) {
        // Clean up the PDF if conversion failed.
        try {
          await unlink(originalPath);
        } catch {
          // ignore cleanup errors
        }
        return NextResponse.json(
          {
            error: `PDF conversion failed: ${convertErr instanceof Error ? convertErr.message : convertErr}`,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ status: "success", name: originalName });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err}` },
      { status: 500 },
    );
  }
}

const SURVEYS_DIR = path.join(process.cwd(), "data", "surveys");

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { error: "Missing floorplan name" },
        { status: 400 },
      );
    }

    if (name === "EmptyFloorPlan.png") {
      return NextResponse.json(
        { error: "Cannot delete the default floor plan" },
        { status: 400 },
      );
    }

    // Delete the media file
    const mediaPath = path.join(MEDIA_DIR, name);
    try {
      await unlink(mediaPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    // Delete associated survey files (including test series)
    const baseName = sanitizeFilename(name);
    try {
      const surveyFiles = await readdir(SURVEYS_DIR);
      for (const file of surveyFiles) {
        if (file.startsWith(`${baseName}.`) && file.endsWith(".json")) {
          try {
            await unlink(path.join(SURVEYS_DIR, file));
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              throw err;
            }
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    return NextResponse.json(
      { error: `Delete failed: ${err}` },
      { status: 500 },
    );
  }
}
