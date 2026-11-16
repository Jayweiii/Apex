/**
 * Apex Sim sound, all synthesised: a four-cylinder engine note that follows
 * revs and throttle, tyre squeal that follows slip, and wind that follows
 * speed. Starts on the first user gesture.
 */
export type SimAudio = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  /** rpm, throttle 0–1, tyre slide 0–1, speed m/s, on grass, running. */
  update: (rpm: number, throttle: number, slide: number, speed: number, grass: boolean, active: boolean) => void;
  dispose: () => void;
};

type Ctor = typeof AudioContext;

export function createSimAudio(): SimAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let oscs: OscillatorNode[] = [];
  let engineGain: GainNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let squealGain: GainNode | null = null;
  let squealFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
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
    engineFilter.frequency.value = 600;
    engineFilter.Q.value = 1.2;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    // Firing frequency, its half (the lumpy four-cylinder beat) and an octave up.
    const voices: Array<[OscillatorType, number]> = [
      ["sawtooth", 0.5],
      ["square", 0.22],
      ["sawtooth", 0.2],
    ];
    oscs = voices.map(([type, level]) => {
      const o = ctx!.createOscillator();
      o.type = type;
      const g = ctx!.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(engineFilter!);
      o.start();
      return o;
    });

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = (filterType: BiquadFilterType, freq: number, q: number): { gain: GainNode; filter: BiquadFilterNode } => {
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx!.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx!.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master!);
      src.start();
      return { gain, filter };
    };
    const squeal = noise("bandpass", 1100, 9);
    squealGain = squeal.gain;
    squealFilter = squeal.filter;
    windGain = noise("lowpass", 500, 0.5).gain;
  };

  return {
    unlock: () => {
      init();
      void ctx?.resume();
    },
    setMuted: (m: boolean) => {
      muted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
    },
    update: (rpm, throttle, slide, speed, grass, active) => {
      if (!ctx || !engineGain || !engineFilter || !squealGain || !squealFilter || !windGain) return;
      const t = ctx.currentTime;
      const fire = (rpm / 60) * 2;
      oscs[0]?.frequency.setTargetAtTime(fire, t, 0.02);
      oscs[1]?.frequency.setTargetAtTime(fire / 2, t, 0.02);
      oscs[2]?.frequency.setTargetAtTime(fire * 2, t, 0.02);
      engineFilter.frequency.setTargetAtTime(350 + rpm * 0.16 + throttle * 1500, t, 0.04);
      engineGain.gain.setTargetAtTime(active ? 0.09 + throttle * 0.2 : 0, t, 0.06);
      squealFilter.frequency.setTargetAtTime(grass ? 320 : 900 + slide * 500, t, 0.05);
      squealGain.gain.setTargetAtTime(active ? Math.min(0.55, slide * (grass ? 0.35 : 0.5)) : 0, t, 0.05);
      windGain.gain.setTargetAtTime(active ? Math.min(0.3, (speed / 60) ** 2 * 0.3) : 0, t, 0.1);
    },
    dispose: () => {
      for (const o of oscs) o.stop();
      void ctx?.close();
      ctx = null;
    },
  };
}
