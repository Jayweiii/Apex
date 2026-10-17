import { assertContentLengthWithinLimits } from "@/lib/abuse-limits";
import { getObjectStorage, storageBackendLabel } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      key?: string;
      contentType?: string;
      kind?: "raw" | "video";
      sessionId?: string;
      filename?: string;
      bytes?: number;
    };

    const filename = (body.filename || "upload.bin").replace(/[^\w.\-]+/g, "_");
    const sessionId = body.sessionId || crypto.randomUUID();
    const kind = body.kind === "video" ? "video" : "raw";
    assertContentLengthWithinLimits(body.bytes, kind);
    const key =
      body.key ||
      `sessions/${sessionId}/${kind}/${Date.now()}-${filename}`;
    const contentType = body.contentType || "application/octet-stream";

    const storage = getObjectStorage();
    const presign = await storage.presignUpload(key, contentType);
    return NextResponse.json({
      ...presign,
      sessionId,
      backend: storageBackendLabel(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Presign failed";
    const status = /too large|exceeds|limit/i.test(message) ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
