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

/**
 * Tiny synth: engine whine, tyre hiss, a boost wash.
 * WebKit throws if AudioContext is constructed or resumed off a user gesture,
 * and that rejection used to surface as an uncaught error. Creation happens
 * only from `resume` (the gesture), and every failure is swallowed.
 */
export function createKartAudio(): KartAudio {
  let ctx: AudioContext | null = null;
  let engine: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let noiseGain: GainNode | null = null;
  let muted = false;
  let armed = false;
  let dead = false;
  try {
    muted = loadKartMuted();
  } catch {
    muted = false;
  }

  function fail() {
    dead = true;
    engine = null;
    engineGain = null;
    noiseGain = null;
    const dying = ctx;
    ctx = null;
    if (dying) {
      try {
        void dying.close();
      } catch {
        // already gone
      }
    }
  }

  function ensure() {
    if (dead || ctx || !armed) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        dead = true;
        return;
      }
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
    } catch {
      fail();
    }
  }

  return {
    resume() {
      armed = true;
      if (dead) return;
      try {
        ensure();
        const pending = ctx?.resume();
        if (pending && typeof pending.then === "function") {
          pending.catch(() => {
            // WebKit rejects resume() outside a gesture. Swallow it.
          });
        }
      } catch {
        fail();
      }
    },
    update(speed, slip, boost, drifting) {
      if (dead || !ctx || !engine || !engineGain || !noiseGain || muted) return;
      try {
        const rate = 68 + speed * 7 + (boost > 0 ? 40 : 0);
        engine.frequency.setTargetAtTime(rate, ctx.currentTime, 0.05);
        engineGain.gain.setTargetAtTime(Math.min(0.045, 0.008 + speed * 0.0011), ctx.currentTime, 0.08);
        const hiss = drifting ? Math.min(0.04, Math.abs(slip) * 0.05) : boost > 0 ? 0.02 : 0;
        noiseGain.gain.setTargetAtTime(hiss, ctx.currentTime, 0.05);
      } catch {
        fail();
      }
    },
    blip(freq, seconds) {
      if (dead || muted || !armed || !ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.05, seconds));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(now + Math.max(0.05, seconds));
      } catch {
        fail();
      }
    },
    setMuted(next) {
      muted = next;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      try {
        if (engineGain && next) engineGain.gain.value = 0;
        if (noiseGain && next) noiseGain.gain.value = 0;
      } catch {
        fail();
      }
    },
    muted: () => muted,
    dispose() {
      dead = true;
      fail();
    },
  };
}
