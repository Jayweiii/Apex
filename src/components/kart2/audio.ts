const MUTE_KEY = "apex.kart2.muted";

export type KartAudio = {
  update: (speed: number, slip: number, boost: number, drifting: boolean) => void;
  blip: (freq: number, seconds: number) => void;
  resume: () => void;
  setMuted: (muted: boolean) => void;
  muted: () => boolean;
  dispose: () => void;
};

export function loadKartMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Tiny synth: engine whine, tyre hiss, a boost wash. Starts silent until a gesture. */
export function createKartAudio(): KartAudio {
  let ctx: AudioContext | null = null;
  let engine: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let noiseGain: GainNode | null = null;
  let muted = false;
  try {
    muted = loadKartMuted();
  } catch {
    muted = false;
  }

  function ensure() {
    if (ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    engine = ctx.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.value = 70;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engine.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engine.start();

    const seconds = 1;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1400;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    src.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    src.start();
  }

  return {
    resume() {
      ensure();
      void ctx?.resume();
    },
    update(speed, slip, boost, drifting) {
      if (!ctx || !engine || !engineGain || !noiseGain || muted) {
        if (engineGain && muted) engineGain.gain.value = 0;
        if (noiseGain && muted) noiseGain.gain.value = 0;
        return;
      }
      const rate = 68 + speed * 7 + (boost > 0 ? 40 : 0);
      engine.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05);
      engineGain.gain.setTargetAtTime(Math.min(0.045, 0.008 + speed * 0.0011), ctx.currentTime, 0.08);
      const hiss = drifting ? Math.min(0.04, Math.abs(slip) * 0.05) : boost > 0 ? 0.02 : 0;
      noiseGain.gain.setTargetAtTime(hiss, ctx.currentTime, 0.05);
    },
    blip(freq, seconds) {
      if (muted) return;
      ensure();
      if (!ctx) return;
      void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + seconds);
    },
    setMuted(next) {
      muted = next;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      if (engineGain) engineGain.gain.value = next ? 0 : engineGain.gain.value;
      if (noiseGain && next) noiseGain.gain.value = 0;
    },
    muted: () => muted,
    dispose() {
      void ctx?.close();
      ctx = null;
    },
  };
}
