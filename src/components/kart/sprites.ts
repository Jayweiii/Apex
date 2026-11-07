/**
 * Pixel art drawn in code (no image assets), rendered once into small
 * canvases at startup. Each string row is one pixel row; each char is a
 * palette key ('.' = transparent).
 */

const PALETTE: Record<string, string> = {
  k: "#0b0b12", // outline
  o: "#f97316", // body (Apex orange)
  O: "#fdba74", // body highlight
  d: "#c2410c", // body shade
  w: "#e0f2fe", // windshield
  b: "#38bdf8", // windshield tint
  t: "#27272a", // tire
  y: "#fde047", // headlight
  r: "#ef4444", // tail light
  s: "#a1a1aa", // helmet / seat
  q: "#fef08a", // item box light
  Q: "#facc15", // item box
  m: "#a16207", // item box shade
  W: "#ffffff",
};

/** Top-down kart, nose up. 9 × 14 px. */
const CAR = [
  "..kyky...",
  ".kOoooOk.",
  "tkoowwok.",
  "tkowbbwkt",
  ".koobbok.",
  ".kooooodk",
  "..koskok.",
  "..kossok.",
  ".koooodk.",
  "tkooooodt",
  "tkoOoodkt",
  ".kooooddk",
  "..krkrk..",
  "...kkk...",
].map((row) => row.padEnd(9, "."));

/** Item box, 8 × 8 px. */
const BOX = [
  "kkkkkkkk",
  "kQQWWQQk",
  "kQWQQWQk",
  "kQQQWQQk",
  "kQQWQQQk",
  "kQQQQQQk",
  "kQQWQQQk",
  "kkkkkkkk",
];

function paint(rows: string[], tint?: Record<string, string>): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d")!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const key = row[x];
      if (key === ".") continue;
      ctx.fillStyle = tint?.[key] ?? PALETTE[key] ?? "#ff00ff";
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

export type KartSprites = {
  car: HTMLCanvasElement;
  box: HTMLCanvasElement;
  grass: CanvasPattern | null;
  checker: CanvasPattern | null;
};

/** Build every sprite once (allocates; never call from the frame loop). */
export function createSprites(ctx: CanvasRenderingContext2D, carColor = "#f97316"): KartSprites {
  const tint = carColor === "#f97316" ? undefined : { o: carColor };
  // Grass: two-tone 4×4 dither tile.
  const grassTile = document.createElement("canvas");
  grassTile.width = 4;
  grassTile.height = 4;
  const g = grassTile.getContext("2d")!;
  g.fillStyle = "#3f8f2f";
  g.fillRect(0, 0, 4, 4);
  g.fillStyle = "#4ea33a";
  g.fillRect(0, 0, 1, 1);
  g.fillRect(2, 2, 1, 1);
  g.fillStyle = "#357a28";
  g.fillRect(3, 1, 1, 1);
  g.fillRect(1, 3, 1, 1);
  const checkTile = document.createElement("canvas");
  checkTile.width = 2;
  checkTile.height = 2;
  const c = checkTile.getContext("2d")!;
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 2, 2);
  c.fillStyle = "#111111";
  c.fillRect(0, 0, 1, 1);
  c.fillRect(1, 1, 1, 1);
  return {
    car: paint(CAR, tint),
    box: paint(BOX),
    grass: ctx.createPattern(grassTile, "repeat"),
    checker: ctx.createPattern(checkTile, "repeat"),
  };
}

/** Kart footprint in metres (sprite is scaled to this). */
export const CAR_WIDTH_M = 2.1;
export const CAR_LENGTH_M = 3.3;
