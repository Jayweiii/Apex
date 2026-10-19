/**
 * Browser-side MP4 / QuickTime creation-time reader.
 *
 * Reads:
 * - moov/mvhd creation_time (Mac epoch → UTC)
 * - QuickTime com.apple.quicktime.creationdate (often local offset, e.g. -0700)
 * - ©day / creation_time style ilst tags when present
 *
 * Designed for File/Blob without loading the whole media into memory.
 */

const MAC_EPOCH_OFFSET_SEC = 2082844800; // 1904-01-01 → 1970-01-01
const MAX_SCAN = 64 * 1024 * 1024; // stop after 64MB of box walk

export type Mp4CreationTimeSource =
  | "mvhd"
  | "quicktime_creationdate"
  | "ilst_day"
  | "none";

export type Mp4CreationTime = {
  /** Best wall-clock for video t=0, epoch ms (UTC). */
  creationTimeMs: number | null;
  source: Mp4CreationTimeSource;
  /** Raw QuickTime string when present. */
  raw?: string;
  /** mvhd creation as UTC ms (may differ from QuickTime local-offset tag). */
  mvhdMs?: number | null;
};

type Box = {
  type: string;
  start: number;
  headerSize: number;
  contentSize: number;
  end: number;
};

async function readSlice(
  blob: Blob,
  start: number,
  length: number,
): Promise<ArrayBuffer> {
  const end = Math.min(blob.size, start + length);
  if (start >= blob.size || end <= start) return new ArrayBuffer(0);
  return blob.slice(start, end).arrayBuffer();
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset);
}

function readU64(view: DataView, offset: number) {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 2 ** 32 + lo;
}

function fourcc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

async function parseBoxAt(blob: Blob, offset: number): Promise<Box | null> {
  if (offset + 8 > blob.size) return null;
  const header = new DataView(await readSlice(blob, offset, 16));
  let size = readU32(header, 0);
  const type = fourcc(header, 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > blob.size) return null;
    size = readU64(header, 8);
    headerSize = 16;
  } else if (size === 0) {
    size = blob.size - offset;
  }
  if (size < headerSize) return null;
  return {
    type,
    start: offset,
    headerSize,
    contentSize: size - headerSize,
    end: offset + size,
  };
}

async function walkBoxes(
  blob: Blob,
  start: number,
  end: number,
  visit: (box: Box) => Promise<"continue" | "stop" | "descend">,
): Promise<"stop" | "done"> {
  let offset = start;
  let scanned = 0;
  while (offset + 8 <= end && scanned < MAX_SCAN) {
    const box = await parseBoxAt(blob, offset);
    if (!box || box.end > end + 8) break;
    scanned += box.headerSize;
    const action = await visit(box);
    if (action === "stop") return "stop";
    if (action === "descend") {
      const inner = await walkBoxes(
        blob,
        box.start + box.headerSize,
        box.end,
        visit,
      );
      if (inner === "stop") return "stop";
    }
    offset = box.end;
  }
  return "done";
}

function macTimeToUnixMs(macSeconds: number): number | null {
  if (!Number.isFinite(macSeconds) || macSeconds <= 0) return null;
  // Treat near-zero as unset.
  if (macSeconds < 1000) return null;
  return (macSeconds - MAC_EPOCH_OFFSET_SEC) * 1000;
}

async function readMvhdCreationMs(blob: Blob, box: Box): Promise<number | null> {
  const buf = await readSlice(blob, box.start + box.headerSize, 32);
  if (buf.byteLength < 20) return null;
  const view = new DataView(buf);
  const version = view.getUint8(0);
  if (version === 1) {
    if (buf.byteLength < 20) return null;
    return macTimeToUnixMs(readU64(view, 4));
  }
  return macTimeToUnixMs(readU32(view, 4));
}

/** Parse QuickTime/ISO-ish creationdate with optional local offset. */
export function parseQuickTimeCreationDate(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 2024-06-15T14:30:00-0700 or 2024-06-15T14:30:00.000-07:00 or …Z
  const normalized = trimmed
    .replace(/(\d{2})(\d{2})$/, (_, h: string, m: string) => `${h}:${m}`)
    .replace(/([+-]\d{2})(\d{2})$/, (_, h: string, m: string) => `${h}:${m}`);

  const ms = Date.parse(normalized);
  if (Number.isFinite(ms)) return ms;

  // Fallback: date-only
  const dateOnly = Date.parse(trimmed.slice(0, 10));
  return Number.isFinite(dateOnly) ? dateOnly : null;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

async function readIlstDataString(
  blob: Blob,
  dataBox: Box,
): Promise<string | null> {
  // data atom: version(1)+flags(3)+locale(4)+payload
  const buf = await readSlice(blob, dataBox.start + dataBox.headerSize, dataBox.contentSize);
  if (buf.byteLength < 8) return null;
  const payload = new Uint8Array(buf, 8);
  const text = decodeUtf8(payload).replace(/\0/g, "").trim();
  return text || null;
}

async function readQuickTimeKeysIlst(
  blob: Blob,
  metaBox: Box,
): Promise<{ creationdate?: string; day?: string }> {
  const keys: string[] = [];
  const values: Record<number, string> = {};
  let keysBox: Box | null = null;
  let ilstBox: Box | null = null;

  await walkBoxes(
    blob,
    metaBox.start + metaBox.headerSize,
    metaBox.end,
    async (box) => {
      if (box.type === "keys") {
        keysBox = box;
        return "continue";
      }
      if (box.type === "ilst") {
        ilstBox = box;
        return "continue";
      }
      // meta may start with 4-byte version/flags
      if (
        box.type === "hdlr" ||
        box.type === "keys" ||
        box.type === "ilst" ||
        box.type === "free"
      ) {
        return "continue";
      }
      return "continue";
    },
  );

  // Some files pad 4 bytes after meta header before children.
  if (!keysBox && !ilstBox) {
    await walkBoxes(
      blob,
      metaBox.start + metaBox.headerSize + 4,
      metaBox.end,
      async (box) => {
        if (box.type === "keys") keysBox = box;
        if (box.type === "ilst") ilstBox = box;
        return "continue";
      },
    );
  }

  if (keysBox) {
    const kb = keysBox as Box;
    const buf = await readSlice(blob, kb.start + kb.headerSize, kb.contentSize);
    const view = new DataView(buf);
    if (buf.byteLength >= 8) {
      const count = readU32(view, 4);
      let o = 8;
      for (let i = 0; i < count && o + 8 <= buf.byteLength; i += 1) {
        const entrySize = readU32(view, o);
        // const ns = fourcc(view, o + 4); // mdta
        if (entrySize < 8 || o + entrySize > buf.byteLength) break;
        const keyBytes = new Uint8Array(buf, o + 8, entrySize - 8);
        keys.push(decodeUtf8(keyBytes).replace(/\0/g, ""));
        o += entrySize;
      }
    }
  }

  if (ilstBox) {
    const ib = ilstBox as Box;
    await walkBoxes(blob, ib.start + ib.headerSize, ib.end, async (item) => {
      // Item type is either fourcc (©day) or index as big-endian in type field.
      const index =
        item.type.charCodeAt(0) === 0
          ? item.type.charCodeAt(3) ||
            (item.type.charCodeAt(0) << 24) +
              (item.type.charCodeAt(1) << 16) +
              (item.type.charCodeAt(2) << 8) +
              item.type.charCodeAt(3)
          : null;

      let dataStr: string | null = null;
      await walkBoxes(
        blob,
        item.start + item.headerSize,
        item.end,
        async (child) => {
          if (child.type === "data") {
            dataStr = await readIlstDataString(blob, child);
            return "stop";
          }
          return "continue";
        },
      );
      if (!dataStr) return "continue";

      if (item.type === "©day" || item.type === "\xA9day") {
        values[-1] = dataStr;
      } else if (index != null && index > 0) {
        values[index] = dataStr;
      } else {
        // Type bytes may be raw index 1..n as uint32 encoded into fourcc string oddly.
        const header = new DataView(
          await readSlice(blob, item.start, item.headerSize),
        );
        if (item.headerSize >= 8) {
          const maybeIndex = readU32(header, 4);
          if (maybeIndex > 0 && maybeIndex < 256) values[maybeIndex] = dataStr;
        }
      }
      return "continue";
    });
  }

  const out: { creationdate?: string; day?: string } = {};
  if (values[-1]) out.day = values[-1];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const val = values[i + 1];
    if (!val) continue;
    if (key.includes("creationdate") || key.endsWith(".creationdate")) {
      out.creationdate = val;
    }
    if (key === "com.apple.quicktime.creationdate") out.creationdate = val;
  }
  return out;
}

/**
 * Extract video creation wall-clock from an MP4/MOV Blob.
 * Prefers QuickTime creationdate (captures local offset from iPhone re-encodes)
 * over mvhd when both exist.
 */
export async function readMp4CreationTime(blob: Blob): Promise<Mp4CreationTime> {
  let mvhdMs: number | null = null;
  let creationdate: string | undefined;
  let day: string | undefined;

  const top = await walkBoxes(blob, 0, blob.size, async (box) => {
    if (box.type === "moov") return "descend";
    if (box.type === "mvhd") {
      mvhdMs = await readMvhdCreationMs(blob, box);
      return "continue";
    }
    if (box.type === "udta") return "descend";
    if (box.type === "meta") {
      const tags = await readQuickTimeKeysIlst(blob, box);
      if (tags.creationdate) creationdate = tags.creationdate;
      if (tags.day) day = tags.day;
      return "continue";
    }
    // Also allow descending trak-less containers / wide free
    if (box.type === "trak" || box.type === "mdia" || box.type === "minf") {
      return "continue";
    }
    return "continue";
  });
  void top;

  if (creationdate) {
    const ms = parseQuickTimeCreationDate(creationdate);
    if (ms != null) {
      return {
        creationTimeMs: ms,
        source: "quicktime_creationdate",
        raw: creationdate,
        mvhdMs,
      };
    }
  }
  if (day) {
    const ms = parseQuickTimeCreationDate(day);
    if (ms != null) {
      return {
        creationTimeMs: ms,
        source: "ilst_day",
        raw: day,
        mvhdMs,
      };
    }
  }
  if (mvhdMs != null) {
    return {
      creationTimeMs: mvhdMs,
      source: "mvhd",
      mvhdMs,
    };
  }
  return { creationTimeMs: null, source: "none", mvhdMs: null };
}

/** Suggest session↔video offset when both clocks are known. */
export function suggestOffsetFromCreationTime(
  videoStartedAtMs: number,
  sessionStartedAtMs: number,
): number {
  return (videoStartedAtMs - sessionStartedAtMs) / 1000;
}

/** Deterministic IndexedDB key for a session-attached MP4. */
export function localVideoBlobKey(sessionId: string, videoId: string, filename?: string) {
  const safe = (filename ?? "clip.mp4").replace(/[^\w.\-]+/g, "_");
  return `local/${sessionId}/video/${videoId}-${safe}`;
}

export function isIdbOnlyObjectKey(objectKey: string | null | undefined): boolean {
  return Boolean(objectKey?.startsWith("local/"));
}
