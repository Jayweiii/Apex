/**
 * Apex Rush sound: everything is synthesised (no audio files). A two-voice
 * engine drone that follows speed, tyre noise while drifting, and short
 * chip-style blips for events. Starts on the first user gesture.
 */
export type RushAudio = {
  /** Call from a tap/click handler so the browser allows sound. */
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  /** Per-frame engine/tyre state. `active` false fades everything out. */
  update: (speed01: number, drifting: boolean, boosting: boolean, offroad: boolean, active: boolean) => void;
  blip: (kind: "count" | "go" | "boost" | "pickup" | "charge" | "wall" | "lap" | "finish" | "ui") => void;
  dispose: () => void;
};

type Ctor = typeof AudioContext;

export function createRushAudio(): RushAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engineA: OscillatorNode | null = null;
  let engineB: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let noiseGain: GainNode | null = null;
  let noiseFilter: BiquadFilterNode | null = null;
  let muted = false;

  const init = () => {
    if (ctx) return;
    const AC: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 700;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineA = ctx.createOscillator();
    engineA.type = "sawtooth";
    engineB = ctx.createOscillator();
    engineB.type = "square";
    engineA.connect(engineFilter);
    engineB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineA.start();
    engineB.start();

    // Looping noise for tyres and dirt.
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 1.4;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();
  };

  const tone = (freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) => {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const t0 = ctx.currentTime + at;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  return {
    unlock: () => {
      init();
      if (ctx && ctx.state === "suspended") void ctx.resume();
    },
    setMuted: (m) => {
      muted = m;
      if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
    },
    update: (speed01, drifting, boosting, offroad, active) => {
      if (!ctx || !engineA || !engineB || !engineGain || !engineFilter || !noiseGain || !noiseFilter) return;
      const t = ctx.currentTime;
      const s = Math.max(0, Math.min(1.4, speed01));
      const base = 55 + s * 150 + (boosting ? 30 : 0);
      engineA.frequency.setTargetAtTime(base, t, 0.06);
      engineB.frequency.setTargetAtTime(base * 1.5, t, 0.06);
      engineFilter.frequency.setTargetAtTime(500 + s * 1600, t, 0.08);
      engineGain.gain.setTargetAtTime(active ? 0.1 + s * 0.07 : 0, t, 0.08);
      noiseFilter.frequency.setTargetAtTime(offroad ? 500 : 2100, t, 0.05);
      noiseGain.gain.setTargetAtTime(active ? (drifting ? 0.16 : offroad && s > 0.1 ? 0.12 : 0) : 0, t, 0.05);
    },
    blip: (kind) => {
      if (!ctx) return;
      if (kind === "count") tone(440, 0, 0.16, "square", 0.22);
      else if (kind === "go") tone(880, 0, 0.5, "square", 0.25);
      else if (kind === "boost") tone(220, 0, 0.45, "sawtooth", 0.22, 990);
      else if (kind === "pickup") {
        tone(660, 0, 0.08, "square", 0.2);
        tone(990, 0.08, 0.12, "square", 0.2);
      } else if (kind === "charge") tone(1180, 0, 0.09, "triangle", 0.2);
      else if (kind === "wall") tone(110, 0, 0.2, "sawtooth", 0.3, 50);
      else if (kind === "lap") {
        tone(523, 0, 0.1, "square", 0.2);
        tone(784, 0.1, 0.18, "square", 0.2);
      } else if (kind === "finish") {
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.2, "square", 0.22));
      } else tone(700, 0, 0.05, "square", 0.12);
    },
    dispose: () => {
      if (ctx) void ctx.close();
      ctx = null;
    },
  };
}
