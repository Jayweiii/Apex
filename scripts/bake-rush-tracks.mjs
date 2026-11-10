/**
 * Bake Apex Rush track data: real circuit outlines (OpenStreetMap) with real
 * elevation (USGS 3DEP along the track, Open-Meteo/Copernicus DEM for the
 * surrounding terrain grid). Run once; output is committed.
 *
 *   node scripts/bake-rush-tracks.mjs <cacheDir>
 *
 * <cacheDir> holds/receives the raw Overpass JSON (th.json, bw.json, sow.json).
 */
import fs from "node:fs";
import path from "node:path";

const cache = process.argv[2] ?? ".rush-cache";
fs.mkdirSync(cache, { recursive: true });
const OUT = "src/lib/rush/data";

const TRACKS = [
  // West: the site's own real GPS lap (public session), not OSM — OSM's West loop is a shorter layout.
  { id: "thunderhill-west", name: "Thunderhill West", location: "Willows, California", gps: "src/lib/rush/data/ghost-thunderhill-west.json", sf: [39.53776, -122.33875] },
  { id: "thunderhill-east", name: "Thunderhill East", location: "Willows, California", raw: "th", way: 28825115, sf: [39.5385, -122.3312], center: [39.5385, -122.3345, 2200] },
  { id: "buttonwillow-13cw", name: "Buttonwillow", location: "Buttonwillow, California", raw: "bw", way: 1449267265, sf: [35.4913, -119.5449], center: [35.4913, -119.5449, 2200], clockwise: true },
  { id: "streets-of-willow-cw", name: "Streets of Willow", location: "Rosamond, California", raw: "sow", way: 10431309, sf: [34.874, -118.263], center: [34.874, -118.263, 1500], clockwise: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(t) {
  const file = path.join(cache, `${t.raw}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const q = `[out:json][timeout:40];way["highway"="raceway"](around:${t.center[2]},${t.center[0]},${t.center[1]});out geom;`;
  for (const host of ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"]) {
    try {
      const res = await fetch(host, { method: "POST", body: new URLSearchParams({ data: q }) });
      const json = await res.json();
      fs.writeFileSync(file, JSON.stringify(json));
      return json;
    } catch {
      /* next host */
    }
  }
  throw new Error(`Overpass failed for ${t.id}`);
}

async function usgs(lat, lon) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const res = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Meters&wkid=4326`);
      const v = Number((await res.json()).value);
      if (Number.isFinite(v) && v > -500) return v;
    } catch {
      /* retry */
    }
    await sleep(400 * (i + 1));
  }
  return NaN;
}

async function openMeteo(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 50) {
    const chunk = points.slice(i, i + 50);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p[0].toFixed(6)).join(",")}&longitude=${chunk.map((p) => p[1].toFixed(6)).join(",")}`;
    let ok = false;
    for (let k = 0; k < 4 && !ok; k += 1) {
      try {
        const json = await (await fetch(url)).json();
        if (Array.isArray(json.elevation)) {
          out.push(...json.elevation);
          ok = true;
        } else console.log("open-meteo:", JSON.stringify(json).slice(0, 160));
      } catch {
        /* retry */
      }
      if (!ok) await sleep(4000 * (k + 1));
    }
    if (!ok) throw new Error("Open-Meteo failed");
    await sleep(700);
  }
  return out;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

for (const t of TRACKS) {
  const outFile = path.join(OUT, `${t.id}.json`);
  if (fs.existsSync(outFile) && !process.env.FORCE) {
    console.log("skip", t.id);
    continue;
  }
  const lat0 = t.sf[0];
  const lon0 = t.sf[1];
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lat, lon]) => [(lon - lon0) * mLon, (lat - lat0) * mLat];
  const toLL = ([x, y]) => [lat0 + y / mLat, lon0 + x / mLon];
  let xy;
  if (t.gps) {
    // Real lap: [east m, north m, ms] relative to the same origin.
    const lap = JSON.parse(fs.readFileSync(t.gps, "utf8"));
    xy = lap.samples.map((s) => [s[0], s[1]]);
    const a = xy[0];
    const b = xy[xy.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 8) xy = xy.slice(0, -1);
  } else {
    const raw = await overpass(t);
    const way = raw.elements.find((e) => e.id === t.way);
    if (!way) throw new Error(`way ${t.way} missing`);
    let ll = way.geometry.map((g) => [g.lat, g.lon]);
    if (ll[0][0] === ll[ll.length - 1][0] && ll[0][1] === ll[ll.length - 1][1]) ll = ll.slice(0, -1);
    xy = ll.map(toXY);
  }

  // Direction: OSM order is the driving direction (oneway) unless forced.
  if (t.clockwise !== undefined) {
    let area = 0;
    for (let i = 0; i < xy.length; i += 1) {
      const a = xy[i];
      const b = xy[(i + 1) % xy.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const isCw = area < 0;
    if (isCw !== t.clockwise) xy.reverse();
  }

  // Resample every 20 m.
  const cum = [0];
  for (let i = 1; i <= xy.length; i += 1) {
    const a = xy[i - 1];
    const b = xy[i % xy.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const n = Math.round(total / 20);
  let pts = [];
  let seg = 0;
  for (let k = 0; k < n; k += 1) {
    const target = (k / n) * total;
    while (cum[seg + 1] < target) seg += 1;
    const f = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const a = xy[seg];
    const b = xy[(seg + 1) % xy.length];
    pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  // Start at the point nearest the site's start/finish reference.
  let best = 0;
  for (let i = 1; i < pts.length; i += 1) if (Math.hypot(...pts[i]) < Math.hypot(...pts[best])) best = i;
  pts = [...pts.slice(best), ...pts.slice(0, best)];

  console.log(t.id, "length", Math.round(total), "points", pts.length, "→ elevation…");
  const z = await pool(pts, 6, (p) => usgs(...toLL(p)));
  // Fill any gaps from neighbours.
  for (let i = 0; i < z.length; i += 1) {
    if (!Number.isFinite(z[i])) {
      let j = 1;
      while (j < z.length && !Number.isFinite(z[(i + j) % z.length])) j += 1;
      z[i] = z[(i + j) % z.length];
    }
  }

  // Terrain grid around the track.
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 320;
  const x0 = Math.min(...xs) - pad;
  const x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad;
  const y1 = Math.max(...ys) + pad;
  const nx = 30;
  const ny = 30;
  const gridPts = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) gridPts.push(toLL([x0 + ((x1 - x0) * i) / (nx - 1), y0 + ((y1 - y0) * j) / (ny - 1)]));
  const gz = await openMeteo(gridPts);
  // Align the coarse DEM to the precise track heights (mean offset).
  const trackDem = await openMeteo(pts.filter((_, i) => i % 4 === 0).map(toLL));
  let off = 0;
  trackDem.forEach((v, i) => (off += z[i * 4] - v));
  off /= trackDem.length;

  const zMin = Math.min(...z);
  const r1 = (v) => Math.round(v * 10) / 10;
  const data = {
    id: t.id,
    name: t.name,
    location: t.location,
    origin: { lat: lat0, lon: lon0 },
    lengthM: Math.round(total),
    /** Closed centreline in driving order: [east m, north m, height m above the track's lowest point]. */
    pts: pts.map((p, i) => [r1(p[0]), r1(p[1]), r1(z[i] - zMin)]),
    /** Terrain heights (same datum) on a regular grid, row-major from (x0, y0). */
    grid: { x0: r1(x0), y0: r1(y0), x1: r1(x1), y1: r1(y1), nx, ny, z: gz.map((v) => r1(v + off - zMin)) },
    baseAslM: r1(zMin),
    sources: [t.gps ? "Outline: real GPS lap uploaded to Apex" : "Outline © OpenStreetMap contributors (ODbL)", "Track elevation: USGS 3DEP", "Terrain: Copernicus DEM via Open-Meteo"],
  };
  fs.writeFileSync(outFile, JSON.stringify(data));
  const zr = data.pts.map((p) => p[2]);
  console.log("  wrote", outFile, "relief", Math.max(...zr).toFixed(1), "m, grid", r1(Math.min(...data.grid.z)), "…", r1(Math.max(...data.grid.z)));
}
