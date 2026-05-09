/* Polyphonic (multi-voice) AudioWorklet oscillator.
   - 3 independent mono voices (PU1, PU2, WAV)
   - 3 mono outputs (one per voice)
   - Sample-accurate retrigger via `noteOn` messages with an absolute AudioContext time
   - Bandlimited-ish waves via PolyBLEP for discontinuous shapes
*/
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

function computeSample(shape, t, dt, duty, voice) {
  let y = 0.0;
  if (shape === "sine") {
    y = Math.sin(2 * Math.PI * t);
  } else if (shape === "saw") {
    y = 2.0 * t - 1.0;
    y -= polyBlep(t, dt);
  } else if (shape === "square") {
    y = t < 0.5 ? 1.0 : -1.0;
    y += polyBlep(t, dt);
    y -= polyBlep((t + 0.5) % 1.0, dt);
  } else if (shape === "pulse") {
    const d = clamp(duty, 0.02, 0.98);
    y = t < d ? 1.0 : -1.0;
    y += polyBlep(t, dt);
    y -= polyBlep((t + (1.0 - d)) % 1.0, dt);
  } else if (shape === "triangle") {
    // Triangle via integrating bandlimited square.
    let sq = t < 0.5 ? 1.0 : -1.0;
    sq += polyBlep(t, dt);
    sq -= polyBlep((t + 0.5) % 1.0, dt);
    voice.triState += (sq * dt) * 2.0;
    voice.triState *= 0.9995;
    y = clamp(voice.triState, -1.0, 1.0);
  } else {
    y = Math.sin(2 * Math.PI * t);
  }
  return y;
}

class TatePolyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq0", defaultValue: 440, minValue: 0, maxValue: 20000, automationRate: "a-rate" },
      { name: "freq1", defaultValue: 440, minValue: 0, maxValue: 20000, automationRate: "a-rate" },
      { name: "freq2", defaultValue: 440, minValue: 0, maxValue: 20000, automationRate: "a-rate" },
      { name: "duty0", defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: "a-rate" },
      { name: "duty1", defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: "a-rate" },
    ];
  }

  constructor() {
    super();
    this.voices = [
      { shape: "pulse", phase: 0.0, triState: 0.0, resetFrame: -1, attackLeft: 0, attackTotal: 0 },
      { shape: "pulse", phase: 0.0, triState: 0.0, resetFrame: -1, attackLeft: 0, attackTotal: 0 },
      { shape: "sine", phase: 0.0, triState: 0.0, resetFrame: -1, attackLeft: 0, attackTotal: 0 },
    ];

    this.port.onmessage = (e) => {
      const msg = e?.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "shape") {
        const ch = clamp(msg.ch | 0, 0, 2);
        const shape = String(msg.shape || "sine");
        const v = this.voices[ch];
        v.shape = shape;
        return;
      }
      if (msg.type === "noteOn") {
        const ch = clamp(msg.ch | 0, 0, 2);
        const t = Number(msg.time);
        const attackSamples = Number.isFinite(msg.attackSamples) ? (msg.attackSamples | 0) : 0;
        if (!Number.isFinite(t)) return;
        const targetFrame = Math.max(0, Math.round(t * sampleRate));
        const v = this.voices[ch];
        v.resetFrame = targetFrame;
        v.attackLeft = Math.max(0, attackSamples);
        v.attackTotal = Math.max(0, attackSamples);
      }
    };
  }

  process(_inputs, outputs, parameters) {
    const out0 = outputs[0]?.[0];
    const out1 = outputs[1]?.[0];
    const out2 = outputs[2]?.[0];
    if (!out0 || !out1 || !out2) return true;

    const sr = sampleRate;
    const frameStart = currentFrame;

    const f0 = parameters.freq0;
    const f1 = parameters.freq1;
    const f2 = parameters.freq2;
    const d0 = parameters.duty0;
    const d1 = parameters.duty1;

    const f0c = f0.length === 1 ? f0[0] : null;
    const f1c = f1.length === 1 ? f1[0] : null;
    const f2c = f2.length === 1 ? f2[0] : null;
    const d0c = d0.length === 1 ? d0[0] : null;
    const d1c = d1.length === 1 ? d1[0] : null;

    for (let i = 0; i < out0.length; i++) {
      const frame = frameStart + i;

      // Voice 0
      {
        const v = this.voices[0];
        if (v.resetFrame === frame) {
          v.phase = 0.0;
          v.triState = 0.0;
          v.resetFrame = -1;
        }
        const freq = clamp(f0c != null ? f0c : f0[i], 0, 20000);
        const duty = clamp(d0c != null ? d0c : d0[i], 0.02, 0.98);
        const dt = freq / sr;
        let p = v.phase + dt;
        if (p >= 1.0) p -= 1.0;
        v.phase = p;
        let y = computeSample(v.shape, p, dt, duty, v);
        if (v.attackLeft > 0) {
          const k = 1.0 - v.attackLeft / Math.max(1, v.attackTotal);
          y *= k;
          v.attackLeft--;
        }
        out0[i] = y;
      }

      // Voice 1
      {
        const v = this.voices[1];
        if (v.resetFrame === frame) {
          v.phase = 0.0;
          v.triState = 0.0;
          v.resetFrame = -1;
        }
        const freq = clamp(f1c != null ? f1c : f1[i], 0, 20000);
        const duty = clamp(d1c != null ? d1c : d1[i], 0.02, 0.98);
        const dt = freq / sr;
        let p = v.phase + dt;
        if (p >= 1.0) p -= 1.0;
        v.phase = p;
        let y = computeSample(v.shape, p, dt, duty, v);
        if (v.attackLeft > 0) {
          const k = 1.0 - v.attackLeft / Math.max(1, v.attackTotal);
          y *= k;
          v.attackLeft--;
        }
        out1[i] = y;
      }

      // Voice 2 (WAV)
      {
        const v = this.voices[2];
        if (v.resetFrame === frame) {
          v.phase = 0.0;
          v.triState = 0.0;
          v.resetFrame = -1;
        }
        const freq = clamp(f2c != null ? f2c : f2[i], 0, 20000);
        const dt = freq / sr;
        let p = v.phase + dt;
        if (p >= 1.0) p -= 1.0;
        v.phase = p;
        let y = computeSample(v.shape, p, dt, 0.5, v);
        if (v.attackLeft > 0) {
          const k = 1.0 - v.attackLeft / Math.max(1, v.attackTotal);
          y *= k;
          v.attackLeft--;
        }
        out2[i] = y;
      }
    }

    return true;
  }
}

registerProcessor("tate-poly", TatePolyProcessor);
