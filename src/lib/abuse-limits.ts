/** Client + server upload abuse limits. */
export const MAX_CSV_BYTES = 25 * 1024 * 1024; // 25 MB
/** Max when actually uploading video to R2 / server / IndexedDB mirror. */
export const MAX_VIDEO_BYTES = 400 * 1024 * 1024; // 400 MB
/**
 * Local GPMF parse only (File.slice / block reader — not uploaded).
 * Covers ~2GB Hero clips; metadata track is a few MB.
 */
export const MAX_GOPRO_PARSE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_UPLOADS_PER_USER_PER_HOUR = 12;
export const MAX_UPLOADS_PER_IP_PER_HOUR = 30;

export function assertFileWithinLimits(
  file: File,
  kind: "csv" | "video" | "gopro-parse",
) {
  const max =
    kind === "gopro-parse"
      ? MAX_GOPRO_PARSE_BYTES
      : kind === "video"
        ? MAX_VIDEO_BYTES
        : MAX_CSV_BYTES;
  if (file.size > max) {
    const mb = Math.round(max / (1024 * 1024));
    const label =
      kind === "gopro-parse"
        ? "GoPro video"
        : kind === "video"
          ? "Video"
          : "CSV";
    throw new Error(
      kind === "gopro-parse"
        ? `${label} is too large to parse in-browser (max ${mb} MB). Export GPX/JSON from Quik / Telemetry Overlay instead.`
        : `${label} is too large (max ${mb} MB).`,
    );
  }
}

export function assertContentLengthWithinLimits(
  bytes: number | undefined,
  kind: "raw" | "video",
) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return;
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_CSV_BYTES;
  if (bytes > max) {
    const mb = Math.round(max / (1024 * 1024));
    throw new Error(
      `${kind === "video" ? "Video" : "File"} exceeds ${mb} MB limit.`,
    );
  }
}

/** Hash an IP for rate-limit rows (no raw IPs stored). */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`apex-upload:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

/**
 * Enforce per-user hourly upload cap using recent sessions rows.
 * Call after ensureAuthenticatedUser, before insert.
 */
export async function assertUserUploadRateLimit(
  client: SupabaseLike,
  userId: string,
): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) {
    // Don't block uploads if count fails (e.g. RLS quirk) — log via throw only on hard cap when known.
    return;
  }
  if ((count ?? 0) >= MAX_UPLOADS_PER_USER_PER_HOUR) {
    throw new Error(
      `Upload rate limit: max ${MAX_UPLOADS_PER_USER_PER_HOUR} sessions per hour. Try again later.`,
    );
  }
}
