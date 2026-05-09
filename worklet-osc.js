/* AudioWorklet oscillator with PolyBLEP smoothing.
   Mono output. Use per-note node recreation for deterministic phase/attack. */

// PolyBLEP helper: cancels discontinuities at waveform edges.
function polyBlep(t, dt) {
  // t in [0,1), dt = phase increment per sample
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

/** True if this sample’s phase step crossed a discontinuity / zero where we can silence without a mid-plateau cut. */
function shouldMuteAtPhaseEdge(shape, p0, p1, wrapped, duty) {
  if (shape === "saw") return wrapped;
  if (shape === "square") return wrapped || (p0 < 0.5 && p1 >= 0.5);
  if (shape === "pulse") return wrapped || (p0 < duty && p1 >= duty);
  // sin(2πt)=0 at t≡0 and t≡0.5 (mod 1): wrap hits t=0; otherwise crossing t=0.5
  if (shape === "sine") return wrapped || (p0 < 0.5 && p1 >= 0.5);
  return false;
}

class TateOscProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequency", defaultValue: 440, minValue: 0, maxValue: 20000, automationRate: "a-rate" },
      { name: "duty", defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: "a-rate" },
    ];
  }

  constructor() {
    super();
    this.shape = "sine"; // "sine" | "triangle" | "saw" | "square" | "pulse"
    this.phase = 0.0; // 0..1
    this.triState = 0.0; // integrator state for triangle
    this.attackSamplesLeft = 0;
    this.attackSamplesTotal = 0;
    /** Last output sample (for zero-cross detect across quanta). */
    this.lastOut = 0.0;
    /** When true, output stays at zero (voice killed at a waveform crossing). */
    this.forceSilent = false;
    /** Cut the next time the waveform crosses zero (sign change) or hits ~0. */
    this.mutePending = false;
    this.muteWaitSamples = 0;
    this.muteMaxWait = 0;
    /** One-shot notify main thread: waveform reached steal cut (so old branch can leave the panner). */
    this.silencedPosted = false;

    this.port.onmessage = (e) => {
      const msg = e?.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "shape" && typeof msg.shape === "string") {
        this.shape = msg.shape;
      } else if (msg.type === "reset") {
        // Reset phase on next render quantum (good enough for per-note nodes).
        this.phase = 0.0;
        this.triState = 0.0;
        this.lastOut = 0.0;
        this.forceSilent = false;
        this.mutePending = false;
        this.silencedPosted = false;
      } else if (msg.type === "attack" && Number.isFinite(msg.samples)) {
        const n = Math.max(0, (msg.samples | 0) >>> 0);
        this.attackSamplesLeft = n;
        this.attackSamplesTotal = n;
      } else if (msg.type === "muteAtNextZero") {
        // Already silent (e.g. steal completed earlier but node still alive): unblock main thread immediately.
        if (this.forceSilent) {
          if (!this.silencedPosted) {
            this.silencedPosted = true;
            this.mutePending = false;
            try {
              this.port.postMessage({ type: "silenced" });
            } catch {
              /* ignore */
            }
          }
          return;
        }
        const sr = typeof globalThis !== "undefined" && globalThis.sampleRate ? globalThis.sampleRate : 48000;
        this.mutePending = true;
        this.muteWaitSamples = 0;
        this.muteMaxWait = Math.ceil(sr * 0.06);
      }
    };
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const ch0 = out[0];
    const sr = sampleRate;

    const freqArr = parameters.frequency;
    const dutyArr = parameters.duty;
    const freqIsConst = freqArr.length === 1;
    const dutyIsConst = dutyArr.length === 1;

    // forceSilent + mutePending: process() early-outs skip mute logic — flush silenced once.
    if (this.forceSilent && this.mutePending && !this.silencedPosted) {
      this.mutePending = false;
      this.silencedPosted = true;
      try {
        this.port.postMessage({ type: "silenced" });
      } catch {
        /* ignore */
      }
    }

    for (let i = 0; i < ch0.length; i++) {
      if (this.forceSilent) {
        ch0[i] = 0.0;
        this.lastOut = 0.0;
        continue;
      }

      const f = clamp(freqIsConst ? freqArr[0] : freqArr[i], 0, 20000);
      const duty = clamp(dutyIsConst ? dutyArr[0] : dutyArr[i], 0.02, 0.98);
      const dt = f / sr;

      const p0 = this.phase;
      let p1 = p0 + dt;
      let wrapped = false;
      if (p1 >= 1.0) {
        p1 -= 1.0;
        wrapped = true;
      }
      this.phase = p1;
      const t = p1;

      let y = 0.0;
      const shape = this.shape;

      if (shape === "sine") {
        y = Math.sin(2 * Math.PI * t);
      } else if (shape === "saw") {
        // Naive saw: -1..+1 with discontinuity at t=0
        y = 2.0 * t - 1.0;
        y -= polyBlep(t, dt);
      } else if (shape === "square") {
        // 50% duty pulse
        y = t < 0.5 ? 1.0 : -1.0;
        y += polyBlep(t, dt);
        y -= polyBlep((t + 0.5) % 1.0, dt);
      } else if (shape === "pulse") {
        y = t < duty ? 1.0 : -1.0;
        y += polyBlep(t, dt);
        y -= polyBlep((t + (1.0 - duty)) % 1.0, dt);
      } else if (shape === "triangle") {
        // Triangle via integrating PolyBLEP square (bandlimited-ish).
        let sq = t < 0.5 ? 1.0 : -1.0;
        sq += polyBlep(t, dt);
        sq -= polyBlep((t + 0.5) % 1.0, dt);
        // Integrate and mildly leak to prevent drift
        this.triState += (sq * dt) * 2.0;
        this.triState *= 0.9995;
        y = clamp(this.triState, -1.0, 1.0);
      } else {
        y = Math.sin(2 * Math.PI * t);
      }

      // Apply a tiny local attack to guarantee a smooth start even for step-y waves.
      if (this.attackSamplesLeft > 0) {
        const k = 1.0 - this.attackSamplesLeft / Math.max(1, this.attackSamplesTotal);
        y *= k;
        this.attackSamplesLeft--;
      }

      if (this.mutePending) {
        this.muteWaitSamples++;
        const lo = this.lastOut;
        const eps = 1e-7;
        const edgeCut = shouldMuteAtPhaseEdge(shape, p0, p1, wrapped, duty);
        const signCross =
          shape === "triangle" &&
          lo !== 0.0 &&
          y !== 0.0 &&
          lo * y < 0.0;
        const nearZeroTri =
          shape === "triangle" && Math.abs(y) <= eps && Math.abs(lo) <= eps;
        // Fallback if edges never fire (shouldn’t happen for sine/square/pulse/saw within one period).
        if (edgeCut || signCross || nearZeroTri || this.muteWaitSamples >= this.muteMaxWait) {
          y = 0.0;
          this.forceSilent = true;
          this.mutePending = false;
          if (!this.silencedPosted) {
            this.silencedPosted = true;
            try {
              this.port.postMessage({ type: "silenced" });
            } catch {
              /* ignore */
            }
          }
        }
      }

      ch0[i] = y;
      this.lastOut = y;
    }

    // If stereo output is requested, copy mono -> all channels.
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}

registerProcessor("tate-osc", TateOscProcessor);

