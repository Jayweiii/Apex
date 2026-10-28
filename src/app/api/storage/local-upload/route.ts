import { assertContentLengthWithinLimits } from "@/lib/abuse-limits";
import {
  assertSafeOwnedUploadKey,
  refuseLocalUploadWhenR2,
  requireStorageUser,
} from "@/lib/storage/auth";
import { createLocalFsStorage } from "@/lib/storage/local-fs";
import { NextResponse } from "next/server";

export async function PUT(request: Request) {
  try {
    refuseLocalUploadWhenR2();
    const { user } = await requireStorageUser();
    const url = new URL(request.url);
    const rawKey = url.searchParams.get("key");
    const contentType =
      url.searchParams.get("contentType") ||
      request.headers.get("content-type") ||
      "application/octet-stream";
    if (!rawKey) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    const key = assertSafeOwnedUploadKey(rawKey, user.id);
    const kind = key.includes("/video/") ? "video" : "raw";
    const headerLen = request.headers.get("content-length");
    const declared =
      headerLen != null && headerLen !== ""
        ? Number(headerLen)
        : undefined;
    if (declared != null && Number.isFinite(declared)) {
      assertContentLengthWithinLimits(declared, kind);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    assertContentLengthWithinLimits(bytes.byteLength, kind);

    const storage = createLocalFsStorage();
    await storage.putObject(key, bytes, contentType);
    return NextResponse.json({ ok: true, key, backend: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    const status =
      (error as { status?: number })?.status ??
      (/sign in/i.test(message)
        ? 401
        : /too large|exceeds|limit|bytes/i.test(message)
          ? 413
          : /invalid|must be|disabled/i.test(message)
            ? 400
            : 500);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  return PUT(request);
}
