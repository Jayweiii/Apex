import { createClient } from "@/lib/supabase/server";
import { hasR2Config } from "@/lib/storage/env";
import type { User } from "@supabase/supabase-js";

/** Object keys for uploads: sessions/{userId}/{sessionId}/{kind}/… */
export function buildOwnedObjectKey(input: {
  userId: string;
  sessionId: string;
  kind: "raw" | "video";
  filename: string;
}): string {
  const filename = input.filename.replace(/[^\w.\-]+/g, "_") || "upload.bin";
  return `sessions/${input.userId}/${input.sessionId}/${input.kind}/${Date.now()}-${filename}`;
}

/** True when key is under the caller's owned prefix. */
export function keyOwnedByUser(key: string, userId: string): boolean {
  const prefix = `sessions/${userId}/`;
  return key.startsWith(prefix) && !key.includes("..");
}

/**
 * Reject path traversal and require sessions/{userId}/… shape for local PUT.
 * Returns normalized key or throws.
 */
export function assertSafeOwnedUploadKey(key: string, userId: string): string {
  const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\0") ||
    normalized.startsWith("/")
  ) {
    throw new Error("Invalid storage key");
  }
  if (!keyOwnedByUser(normalized, userId)) {
    throw new Error("Storage key must be under your sessions prefix");
  }
  return normalized;
}

export async function requireStorageUser(): Promise<{
  user: User;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const err = new Error("Sign in required");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return { user, supabase };
}

/**
 * Authorize reading an object key: owner prefix, or a session/video the
 * caller can already read via RLS (public / friends / own).
 */
export async function authorizeObjectDownload(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  user: User | null,
): Promise<boolean> {
  if (!key || key.includes("..")) return false;
  if (user && keyOwnedByUser(key, user.id)) return true;

  // Legacy keys: sessions/{sessionId}/…
  // New keys: sessions/{userId}/{sessionId}/…
  const { data: byRaw } = await supabase
    .from("sessions")
    .select("id")
    .eq("raw_object_key", key)
    .limit(1)
    .maybeSingle();
  if (byRaw?.id) return true;

  const { data: byVideo } = await supabase
    .from("sessions")
    .select("id")
    .eq("video_object_key", key)
    .limit(1)
    .maybeSingle();
  if (byVideo?.id) return true;

  const { data: byRow } = await supabase
    .from("session_videos")
    .select("id")
    .eq("object_key", key)
    .limit(1)
    .maybeSingle();
  if (byRow?.id) return true;

  return false;
}

export function refuseLocalUploadWhenR2(): void {
  if (hasR2Config()) {
    const err = new Error("Local upload is disabled when R2 is configured");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
}
