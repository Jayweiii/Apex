/** Apex mark: a pixel corner with the racing line clipping its apex. */
export function PixelMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  // 12×12 grid. "#" = kerb (orange), "o" = racing line (white), "." = empty.
  const rows = [
    "........####",
    "......###...",
    ".....##.....",
    "....##..ooo.",
    "...##..oo...",
    "...#..oo....",
    "..##.oo.....",
    "..#..o......",
    "..#.oo......",
    "..#.o.......",
    "..#.o.......",
    "..#.o.......",
  ];
  const cells: Array<{ x: number; y: number; fill: string }> = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = row[x];
      if (c === "#") cells.push({ x, y, fill: (x + y) % 2 === 0 ? "#f97316" : "#f0f2f8" });
      else if (c === "o") cells.push({ x, y, fill: "#4cc9f0" });
    }
  });
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className={className}>
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill={c.fill} />
      ))}
    </svg>
  );
}
