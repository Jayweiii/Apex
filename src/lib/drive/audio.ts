/**
 * Lightweight Web Audio engine + tire scrub for Drive.
 * Mute preference is local-only under apex.drive.*.
 */

const MUTE_KEY = "apex.drive.muted";

export function loadDriveMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDriveMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // ignore
  }
}

export type DriveAudioHandle = {
  resume: () => void;
  setMuted: (muted: boolean) => void;
  /** Update continuous loops from sim state. */
  tick: (opts: {
    speed: number;
    maxSpeed: number;
    throttle: number;
    brake: number;
    slip: number;
    onTrack: boolean;
    onCurb: boolean;
    paused: boolean;
  }) => void;
  dispose: () => void;
};

export function createDriveAudio(): DriveAudioHandle {
  let ctx: AudioContext | null = null;
  let engineOsc: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let tireSource: AudioBufferSourceNode | null = null;
  let tireGain: GainNode | null = null;
  let curbOsc: OscillatorNode | null = null;
  let curbGain: GainNode | null = null;
  let master: GainNode | null = null;
  let muted = loadDriveMuted();
  let started = false;

  function ensure() {
    if (typeof window === "undefined") return;
    if (ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.22;
    master.connect(ctx.destination);

    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 55;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 900;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    // Soft noise buffer for tire scrub
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    tireSource = ctx.createBufferSource();
    tireSource.buffer = buf;
    tireSource.loop = true;
    tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 1400;
    tireFilter.Q.value = 0.7;
    tireSource.connect(tireFilter);
    tireFilter.connect(tireGain);
    tireGain.connect(master);

    curbOsc = ctx.createOscillator();
    curbOsc.type = "square";
    curbOsc.frequency.value = 38;
    curbGain = ctx.createGain();
    curbGain.gain.value = 0;
    curbOsc.connect(curbGain);
    curbGain.connect(master);

    engineOsc.start();
    tireSource.start();
    curbOsc.start();
    started = true;
  }

  return {
    resume() {
      ensure();
      void ctx?.resume();
    },
    setMuted(next: boolean) {
      muted = next;
      saveDriveMuted(next);
      if (master && ctx) {
        master.gain.setTargetAtTime(next ? 0 : 0.22, ctx.currentTime, 0.05);
      }
    },
    tick(opts) {
      if (!started || !ctx || !engineOsc || !engineGain || !engineFilter) return;
      if (opts.paused || muted) {
        engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        tireGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        curbGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        return;
      }
      const speed01 = Math.min(1, Math.abs(opts.speed) / Math.max(1, opts.maxSpeed));
      const rpm = 70 + speed01 * 220 + opts.throttle * 40;
      engineOsc.frequency.setTargetAtTime(rpm, ctx.currentTime, 0.04);
      engineFilter.frequency.setTargetAtTime(
        600 + speed01 * 1800 + opts.throttle * 400,
        ctx.currentTime,
        0.05,
      );
      const engVol =
        0.02 +
        speed01 * 0.12 +
        opts.throttle * 0.1 +
        (opts.brake > 0.2 ? 0.02 : 0);
      engineGain.gain.setTargetAtTime(engVol, ctx.currentTime, 0.06);

      const slipAmt = Math.min(1, Math.abs(opts.slip) / 4);
      const tireVol =
        slipAmt * 0.14 + (!opts.onTrack ? 0.05 + speed01 * 0.06 : 0);
      tireGain?.gain.setTargetAtTime(tireVol, ctx.currentTime, 0.05);

      const curbVol = opts.onCurb && opts.onTrack ? 0.035 + speed01 * 0.05 : 0;
      curbGain?.gain.setTargetAtTime(curbVol, ctx.currentTime, 0.03);
      if (curbOsc && opts.onCurb) {
        curbOsc.frequency.setTargetAtTime(
          32 + speed01 * 55,
          ctx.currentTime,
          0.04,
        );
      }
    },
    dispose() {
      try {
        engineOsc?.stop();
        tireSource?.stop();
        curbOsc?.stop();
      } catch {
        // already stopped
      }
      void ctx?.close();
      ctx = null;
      started = false;
    },
  };
}
