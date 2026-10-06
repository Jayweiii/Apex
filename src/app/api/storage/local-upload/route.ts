import { createLocalFsStorage } from "@/lib/storage/local-fs";
import { NextResponse } from "next/server";

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const contentType =
    url.searchParams.get("contentType") ||
    request.headers.get("content-type") ||
    "application/octet-stream";
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const storage = createLocalFsStorage();
  await storage.putObject(key, bytes, contentType);
  return NextResponse.json({ ok: true, key, backend: "local" });
}

export async function POST(request: Request) {
  return PUT(request);
}
