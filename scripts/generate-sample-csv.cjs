const fs = require("fs");
const path = require("path");

function speedAt(progress) {
  const corners = [
    [0.12, 0.55],
    [0.28, 0.48],
    [0.41, 0.62],
    [0.57, 0.5],
    [0.73, 0.42],
    [0.88, 0.7],
  ];
  let factor = 1;
  for (const [center, depth] of corners) {
    const d = Math.abs(progress - center);
    const width = 0.06;
    if (d < width) {
      const dip = (1 - d / width) ** 2;
      factor -= (1 - depth) * dip;
    }
  }
  return 70 + 150 * Math.max(0.25, factor);
}

function trackPoint(progress, lapIndex) {
  const a = progress * Math.PI * 2;
  const scale = 2.6;
  const x = scale * (0.0034 * Math.sin(a) + 0.0009 * Math.sin(2 * a));
  const y = scale * (0.0021 * Math.cos(a) + 0.00045 * Math.cos(3 * a));
  const dx = scale * (0.0034 * Math.cos(a) + 0.0018 * Math.cos(2 * a));
  const dy = scale * (-0.0021 * Math.sin(a) - 0.00135 * Math.sin(3 * a));
  const len = Math.hypot(dx, dy) || 1;
  const shift = (lapIndex - 1) * 0.0007;
  return {
    lat: 36.584 + y + shift * (-dy / len),
    lon: -121.753 + x + shift * (dx / len),
  };
}

const rows = ["lap,time,speed,lat,lon"];
const hz = 5;
const lapTimes = [92.431, 91.208, 91.874];

for (let lap = 0; lap < lapTimes.length; lap += 1) {
  const duration = lapTimes[lap];
  const samples = Math.round(duration * hz);
  const offset = lap === 0 ? 0 : 0.4 * lap;
  for (let i = 0; i <= samples; i += 1) {
    const t = Number((i / hz).toFixed(3));
    if (t > duration) break;
    const progress = Math.min(1, t / duration);
    const noise = Math.sin((t + offset) * 7.3) * 1.4;
    const speed = Math.max(40, speedAt(progress) + noise - lap * 0.4);
    const { lat, lon } = trackPoint(progress, lap);
    rows.push(
      `${lap + 1},${t.toFixed(3)},${speed.toFixed(2)},${lat.toFixed(6)},${lon.toFixed(6)}`,
    );
  }
}

const out = path.join(__dirname, "..", "public", "sample-telemetry.csv");
fs.writeFileSync(out, rows.join("\n") + "\n");
console.log(`wrote ${rows.length - 1} samples to ${out}`);
