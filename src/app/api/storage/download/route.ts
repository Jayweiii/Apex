import { getObjectStorage } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const storage = getObjectStorage();
  if (storage.backend === "r2") {
    const url = await storage.getDownloadUrl(key);
    return NextResponse.redirect(url);
  }

  const object = await storage.getObject(key);
  if (!object) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lower = key.toLowerCase();
  const contentType = lower.endsWith(".mp4")
    ? "video/mp4"
    : lower.endsWith(".csv")
      ? "text/csv"
      : "application/octet-stream";

  return new NextResponse(new Uint8Array(object), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
