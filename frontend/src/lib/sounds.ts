// Move sounds synthesised with Web Audio, so no sound files are shipped.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function knock(ac: AudioContext, at: number, freq: number, gain: number, length = 0.07) {
  // Short filtered noise burst: a wooden "tock".
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * length), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

function tone(ac: AudioContext, at: number, freq: number, length: number, gain: number) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function playSound(kind: "move" | "capture" | "check") {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  if (kind === "move") {
    knock(ac, t, 1800, 0.9);
  } else if (kind === "capture") {
    knock(ac, t, 900, 1.2, 0.09);
    knock(ac, t + 0.045, 1500, 0.7);
  } else {
    knock(ac, t, 1800, 0.8);
    tone(ac, t + 0.02, 880, 0.18, 0.12);
    tone(ac, t + 0.11, 1175, 0.22, 0.1);
  }
}
