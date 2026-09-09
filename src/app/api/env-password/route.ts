/**
 * /api/env-password
 * GET /api/env-password
 * Returns the sudo password from the server's environment variables.
 * This allows users to store the password in a .env file on the server
 * instead of typing it every time.
 *
 * IMPORTANT: This endpoint must only be used in local development.
 * The password is never stored in survey files and never exposed to the client
 * except through this server-side endpoint.
 */
import { NextResponse } from "next/server";

export async function GET() {
  const password = process.env.SUDOER_PASSWORD || "";
  return NextResponse.json({ sudoerPassword: password });
}
