/**
 * /api/env-config
 * GET /api/env-config
 * Returns server-side environment values that should pre-fill the UI settings.
 * This allows users to store the sudo password and iperf3 server address
 * in a .env file on the server instead of typing them every time.
 *
 * IMPORTANT: This endpoint must only be used in local development.
 * Sensitive values are never stored in survey files.
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    sudoerPassword: process.env.SUDOER_PASSWORD || "",
    iperfServerAdrs: process.env.IPERF_SERVER_ADRS || "localhost",
  });
}
