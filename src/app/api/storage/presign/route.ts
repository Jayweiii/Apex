import { assertContentLengthWithinLimits } from "@/lib/abuse-limits";
import {
  buildOwnedObjectKey,
  requireStorageUser,
} from "@/lib/storage/auth";
import { getObjectStorage, storageBackendLabel } from "@/lib/storage";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { user } = await requireStorageUser();
    const body = (await request.json()) as {
      contentType?: string;
      kind?: "raw" | "video";
      sessionId?: string;
      filename?: string;
      bytes?: number;
    };

    const filename = (body.filename || "upload.bin").replace(/[^\w.\-]+/g, "_");
    const sessionId = body.sessionId || crypto.randomUUID();
    const kind = body.kind === "video" ? "video" : "raw";
    // Size is mandatory — omit/null must not bypass the limit.
    assertContentLengthWithinLimits(body.bytes, kind);
    // Ignore any client-supplied key; bind to the authenticated user.
    const key = buildOwnedObjectKey({
      userId: user.id,
      sessionId,
      kind,
      filename,
    });
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
    const status =
      (error as { status?: number })?.status === 401
        ? 401
        : /too large|exceeds|limit|required|finite|bytes/i.test(message)
          ? 413
          : /sign in/i.test(message)
            ? 401
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
