/* global Tone */

const STORAGE_KEY = "tate-tracker:v1";
const BUILD_TAG = "poly-worklet-2";

// Audio debug: defaults OFF. Enable with `window.DEBUG_AUDIO = true` or `?audioDebug=1`.
const AUDIO_DEBUG_DEFAULT = false;
/** When true (or `?audioTiming=1`), logs scheduling skew / safeTime slip for every trigger (not throttled). */
let audioTimingFromUrl = null;
let audioDebugLastLogAt = 0;
let audioDebugBurst = 0;
let audioDebugLines = [];
let elAudioDebug = null;
let elAudioDebugCopyBtn = null;
let elAudioDebugMarkBtn = null;
let audioDebugOscId = 0;
let audioDebugTriggerCount = 0;
function anyAudioDebugUIEnabled() {
  return audioDebugEnabled() || audioTimingDebugEnabled();
}

function audioTimingDebugEnabled() {
  try {
    if (typeof window !== "undefined" && window.DEBUG_AUDIO_TIMING === true) return true;
    if (typeof window !== "undefined" && window.DEBUG_AUDIO_TIMING === false) return false;
    if (audioTimingFromUrl == null) {
      audioTimingFromUrl = false;
      if (typeof window !== "undefined" && window.location?.search) {
        const q = new URLSearchParams(window.location.search);
        const a = q.get("audioTiming");
        const t = q.get("timing");
        const on = (v) => v === "1" || v === "true" || v === "";
        audioTimingFromUrl = on(a) || on(t);
      }
    }
    return audioTimingFromUrl;
  } catch {
    return false;
  }
}

function ensureAudioDebugOverlay() {
  try {
    if (!anyAudioDebugUIEnabled()) return null;
    if (elAudioDebug && document.body.contains(elAudioDebug)) return elAudioDebug;
    elAudioDebug = document.getElementById("audioDebugOverlay");
    if (elAudioDebug) return elAudioDebug;
    const pre = document.createElement("pre");
    pre.id = "audioDebugOverlay";
    pre.style.position = "fixed";
    pre.style.left = "8px";
    pre.style.right = "8px";
    // Move up a bit so the nudge bar remains reachable.
    pre.style.bottom = "132px";
    // Keep it small so it doesn’t cover the grids.
    pre.style.maxHeight = "12vh";
    pre.style.overflow = "auto";
    pre.style.padding = "10px 12px";
    pre.style.margin = "0";
    pre.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    pre.style.fontSize = "11px";
    pre.style.lineHeight = "1.35";
    pre.style.border = "1px solid rgba(103,232,249,0.25)";
    pre.style.borderRadius = "10px";
    pre.style.background = "rgba(7, 9, 12, 0.88)";
    pre.style.color = "#c7fbff";
    pre.style.zIndex = "9999";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.pointerEvents = "auto";
    document.body.appendChild(pre);
    elAudioDebug = pre;

    // Copy button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Copy audio logs";
    btn.style.position = "fixed";
    btn.style.right = "12px";
    btn.style.bottom = "calc(132px + 12vh + 10px)";
    btn.style.zIndex = "10000";
    btn.style.padding = "8px 10px";
    btn.style.fontFamily = "inherit";
    btn.style.fontSize = "12px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid rgba(103,232,249,0.35)";
    btn.style.background = "rgba(7, 9, 12, 0.92)";
    btn.style.color = "#c7fbff";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", async () => {
      const text = audioDebugLines.join("\n");
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied!";
          window.setTimeout(() => { btn.textContent = "Copy audio logs"; }, 1200);
          return;
        }
      } catch {
        /* fall through */
      }
      // Fallback: prompt for manual copy
      window.prompt("Copy audio logs:", text);
    });
    document.body.appendChild(btn);
    elAudioDebugCopyBtn = btn;

    return pre;
  } catch {
    return null;
  }
}
function pushAudioDebugLine(line) {
  const cap = audioTimingDebugEnabled() ? 200 : 80;
  audioDebugLines.push(line);
  if (audioDebugLines.length > cap) audioDebugLines = audioDebugLines.slice(-cap);
  const el = ensureAudioDebugOverlay();
  if (el) el.textContent = audioDebugLines.join("\n");
}
function audioDebugEnabled() {
  try {
    if (typeof window !== "undefined" && window.DEBUG_AUDIO === true) return true;
    if (typeof window !== "undefined" && window.DEBUG_AUDIO === false) return false;
    if (typeof window !== "undefined" && window.location?.search) {
      const q = new URLSearchParams(window.location.search);
      const v = q.get("audioDebug");
      if (v === "1" || v === "true" || v === "") return true;
      if (v === "0" || v === "false") return false;
    }
  } catch { /* ignore */ }
  return AUDIO_DEBUG_DEFAULT;
}
function audioDebugLog(obj) {
  if (!audioDebugEnabled()) return;
  const nowMs = performance?.now ? performance.now() : Date.now();
  // Throttle: max ~12 logs/sec, with small bursts.
  if (nowMs - audioDebugLastLogAt < 80) {
    audioDebugBurst++;
    if (audioDebugBurst > 2) return;
  } else {
    audioDebugBurst = 0;
    audioDebugLastLogAt = nowMs;
  }
  try {
    // Keep it single-line so it’s easy to scan.
    const line = `[audio-debug] ${JSON.stringify(obj)}`;
    // Console (when available)
    try { console.log(line); } catch { /* ignore */ }
    // In-app overlay (always)
    pushAudioDebugLine(line);
  } catch { /* ignore */ }
}

function audioDebugLogCritical(obj) {
  if (!audioDebugEnabled()) return;
  try {
    const line = `[audio-debug] ${JSON.stringify(obj)}`;
    try { console.log(line); } catch { /* ignore */ }
    pushAudioDebugLine(line);
  } catch { /* ignore */ }
}

function audioTimingLog(obj) {
  if (!audioTimingDebugEnabled()) return;
  try {
    const line = `[audio-timing] ${JSON.stringify(obj)}`;
    try {
      console.log(line);
    } catch {
      /* ignore */
    }
    pushAudioDebugLine(line);
  } catch {
    /* ignore */
  }
}

// Ensure the overlay exists early so it's visible even if audio never starts.
try {
  if (anyAudioDebugUIEnabled()) {
    ensureAudioDebugOverlay();
    pushAudioDebugLine(`[audio-debug] ${JSON.stringify({ where: "boot", href: window.location?.href || "", build: BUILD_TAG })}`);
  }
  if (audioTimingDebugEnabled()) {
    ensureAudioDebugOverlay();
    pushAudioDebugLine(
      `[audio-timing] ${JSON.stringify({
        where: "boot.hint",
        msg: "Per-trigger scheduling lines follow when you play. URL: add ?audioTiming=1 — console: window.DEBUG_AUDIO_TIMING=true — off: false",
      })}`,
    );
  }
} catch { /* ignore */ }

function fmtTime(t) {
  return Math.round((Number(t) || 0) * 1000) / 1000;
}

function logTransportCallbackTiming(mode, transportTime, tickAudioNow) {
  if (!audioTimingDebugEnabled()) return;
  const t = Number(transportTime) || 0;
  const now = Number.isFinite(tickAudioNow) ? tickAudioNow : t;
  let bpm = null;
  try {
    bpm = Tone.Transport?.bpm?.value ?? null;
  } catch {
    /* ignore */
  }
  audioTimingLog({
    where: "transport.callback",
    mode,
    transportT: fmtTime(t),
    audioNowT: fmtTime(now),
    skewAudioMinusTransportMs: Math.round((now - t) * 1000),
    bpm,
  });
}

const ROWS = 16;
const BPM_RANGE_MIN = 40;
const BPM_RANGE_MAX = 300;
const SONG_COLS = [
  { key: "PU1", label: "PU1" },
  { key: "PU2", label: "PU2" },
  { key: "WAV", label: "WAV" },
  { key: "NOI", label: "NOI" },
];
const CHAIN_COLS = [
  { key: "PHR", label: "PHR" },
  { key: "TSP", label: "TSP" },
];
const COLS = [
  { key: "row", label: "Row", kind: "row" },
  { key: "note", label: "Note", kind: "note" },
  { key: "instr", label: "INST", kind: "byte" },
  { key: "cmd", label: "Cmd", kind: "cmd" },
  { key: "val", label: "Val", kind: "byte" },
];

const NUM_INSTRUMENTS = 32;
const INSTRUMENT_PARAM_ROWS = 9;
const INSTRUMENT_ROW_LABELS = [
  "INSTR",
  "TYPE",
  "MODE",
  "ENV 1",
  "ENV 2",
  "ENV 3",
  "LENGTH",
  "OUTPUT",
  "TABLE",
];
const TABLE_PRESET_NAMES = [
  "None",
  "Kick",
  "Snare",
  "Hat-C",
  "Hat-O",
  "Bass",
  "Lead",
  "Pad",
  "Sweep",
  "Zap",
  "Glitch",
  "Arp",
];
const PULSE_MODE_LABELS = ["12.5%", "25%", "50%", "75%"];
const WAVE_MODE_LABELS = ["Tri", "Saw", "Sq", "Sine"];
const NOISE_MODE_LABELS = ["White", "Pink", "Metal", "Brown"];
const OUTPUT_LABELS = ["Both", "Left", "Right"];
const INSTRUMENT_TYPE_LABELS = ["Pulse", "Wave", "Noise"];

function instrumentDefaultName(index) {
  return `INST ${idHex(clamp(index | 0, 0, NUM_INSTRUMENTS - 1))}`;
}

function defaultInstrumentObject(index) {
  return {
    name: instrumentDefaultName(index),
    type: 0,
    mode: 0x01,
    env1: 0x0a,
    env2: 0x00,
    env3: 0x01,
    output: 0x00,
    length: 0x1f,
    tablePreset: 0,
  };
}

function normalizeInstrumentObject(index, raw) {
  const base = defaultInstrumentObject(index);
  if (!raw || typeof raw !== "object") return base;
  const o = { ...base, ...raw };
  o.name = instrumentDefaultName(index);
  o.type = clamp(Number(o.type) || 0, 0, 2);
  o.mode = clamp(Number(o.mode) || 0, 0, 3);
  o.env1 = clamp((Number(o.env1) || 0) | 0, 0, 0x0f);
  o.env2 = clamp((Number(o.env2) || 0) | 0, 0, 0x01);
  o.env3 = clamp((Number(o.env3) || 0) | 0, 0, 0x0f);
  o.output = clamp(Number(o.output) || 0, 0, 2);
  o.length = clamp(Number(o.length) || 0, 0, 31);
  o.tablePreset = clamp(Number(o.tablePreset) || 0, 0, 11);
  return o;
}

function ensureInstrumentsInState(s) {
  if (!Array.isArray(s.instruments) || s.instruments.length !== NUM_INSTRUMENTS) {
    s.instruments = Array.from({ length: NUM_INSTRUMENTS }, (_, i) => defaultInstrumentObject(i));
  } else {
    for (let i = 0; i < NUM_INSTRUMENTS; i++) {
      s.instruments[i] = normalizeInstrumentObject(i, s.instruments[i]);
    }
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toHex2(n) {
  const v = clamp(Number.isFinite(n) ? n : 0, 0, 255) | 0;
  return v.toString(16).toUpperCase().padStart(2, "0");
}

function parseHexByte(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().toUpperCase();
  if (!/^[0-9A-F]{2}$/.test(t)) return null;
  return parseInt(t, 16);
}

function rowHex(i) {
  return i.toString(16).toUpperCase().padStart(2, "0");
}

function idHex(id) {
  return toHex2(clamp(id | 0, 0, 255));
}

function phraseLabel(id) {
  return `Phrase ${idHex(id)}`;
}
function chainLabel(id) {
  return `Chain ${idHex(id)}`;
}

function slotLabel(kind, id) {
  if (id == null) return "--";
  return idHex(id);
}

function safeB64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function safeB64DecodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

function normalizeNote(s) {
  if (typeof s !== "string") return "";
  const t = s.trim().toUpperCase();
  if (t === "" || t === "--") return "";
  // Accept basic scientific pitch notation: C4, D#5, F3, etc.
  if (!/^[A-G]#?[0-8]$/.test(t)) return "";
  return t;
}

const NOTE_PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** LSDJ-style tick commands (mutually exclusive per step). */
const CMD_SET = new Set(["C", "D", "E", "L", "P", "R", "S", "V", "W"]);
const CMD_ORDER = [null, "C", "D", "E", "L", "P", "R", "S", "V", "W"];
/** Nudge / cycle order (no `--` in array; null handled separately in `applyCmdDeltaToStep`). */
const PHRASE_CMD_CYCLE = ["C", "D", "E", "L", "P", "R", "S", "V", "W"];
/** Subdivisions per phrase step (one Transport hit = one row). */
const TICKS_PER_STEP = 6;
/** Vibrato depth in semitones by CMD `V` low nibble. */
const VIBRATO_DEPTH_SEMITONES = [0, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const POLY_LOOKAHEAD_SEC = 0.002;
const PHRASE_NOTE_NUM_MIN = 0;
const PHRASE_NOTE_NUM_MAX = 8 * 12 + 11; // B8
/** First note set when nudging from an empty cell (UI `---`); matches common “C3” anchor. */
const NOTE_NUDGE_INITIAL = "C3";
/** Chain transpose semitones: ±0x30 (±48, four octaves). Byte `00` displays as `--`. */
const TSP_SEMIS_MAX = 0x30;
const TSP_SEMIS_MIN = -0x30;

function normalizeCmd(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim().toUpperCase();
    if (t === "" || t === "--" || t === ".") return null;
    return CMD_SET.has(t) ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return null;
  }
  return null;
}

function byteOrNullFromLegacy(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return clamp(value | 0, 0, 255);
  const s = String(value).trim().toUpperCase();
  if (s === "" || s === "--" || s === ".") return null;
  const hex = parseHexByte(s);
  if (hex != null) return hex;
  return null;
}

function cmdByteFromLegacy(value) {
  return normalizeCmd(value);
}

function displayByte(byte, { kind } = { kind: "hex" }) {
  if (byte == null) return "--";
  if (kind === "cmd") return normalizeCmd(byte) ?? "--";
  const b = clamp(byte | 0, 0, 255);
  return toHex2(b);
}

function parseNote(note) {
  const n = normalizeNote(note);
  if (!n) return null;
  const pitch = n.slice(0, -1);
  const octave = clamp(parseInt(n.slice(-1), 10), 0, 8);
  const idx = NOTE_PITCHES.indexOf(pitch);
  if (idx < 0) return null;
  return { idx, octave };
}

function makeNote({ idx, octave }) {
  const i = ((idx % 12) + 12) % 12;
  const o = clamp(octave | 0, 0, 8);
  return `${NOTE_PITCHES[i]}${o}`;
}

function noteNumberFromParts({ idx, octave }) {
  const i = clamp(idx | 0, 0, 11);
  const o = clamp(octave | 0, 0, 8);
  return o * 12 + i;
}

function partsFromNoteNumber(n) {
  const nn = clamp((n ?? 0) | 0, 0, 8 * 12 + 11);
  const octave = Math.floor(nn / 12);
  const idx = nn % 12;
  return { idx, octave };
}

function randomInt(min, max) {
  const a = Math.ceil(Number(min) || 0);
  const b = Math.floor(Number(max) || 0);
  if (b <= a) return a;
  return a + Math.floor(Math.random() * (b - a + 1));
}

function placeholderOrNote(note) {
  const n = normalizeNote(note);
  return n || "--";
}

function defaultState() {
  const phrase00 = {
    steps: Array.from({ length: ROWS }, () => ({
      note: "",
      instr: null,
      cmd: null,
      val: null,
    })),
  };
  const out = {
    bpm: 120,
    visualOffsetMs: 0,
    pulse1Width: 50,
    pulse2Width: 50,
    wavType: "triangle",
    noiseType: "white",
    mixVol: [90, 90, 90, 90],
    song: Array.from({ length: ROWS }, () => SONG_COLS.map(() => null)), // 4 chain ids per row (nullable for "--")
    chains: {
      0x00: Array.from({ length: ROWS }, () => emptyChainRow()), // chain rows: { phraseId, tsp }
    },
    phrases: {
      0x00: phrase00,
    },
    instruments: Array.from({ length: NUM_INSTRUMENTS }, (_, i) => defaultInstrumentObject(i)),
    /** Phrase editor: last focused instrument (00–1F) for auto-assign on new notes. */
    activeInstrumentId: 0,
    selectionAnchor: null,
    selectedRange: null,
  };
  ensureInstrumentsInState(out);
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const s = defaultState();

    if (Number.isFinite(parsed?.bpm)) s.bpm = clamp(parsed.bpm, BPM_RANGE_MIN, BPM_RANGE_MAX);
    if (Number.isFinite(parsed?.visualOffsetMs)) s.visualOffsetMs = clamp(parsed.visualOffsetMs | 0, 0, 500);
    if (Number.isFinite(parsed?.pulse1Width)) s.pulse1Width = parsed.pulse1Width;
    if (Number.isFinite(parsed?.pulse2Width)) s.pulse2Width = parsed.pulse2Width;
    if (typeof parsed?.wavType === "string") s.wavType = parsed.wavType;
    if (typeof parsed?.noiseType === "string") s.noiseType = parsed.noiseType;
    if (Array.isArray(parsed?.mixVol) && parsed.mixVol.length >= 4) {
      s.mixVol = [0, 1, 2, 3].map((i) => clamp(parseInt(parsed.mixVol[i], 10) || 0, 0, 100));
    }
    if (Number.isFinite(parsed?.activeInstrumentId)) {
      s.activeInstrumentId = clamp((parsed.activeInstrumentId | 0) >>> 0, 0, NUM_INSTRUMENTS - 1);
    }

    // New model
    if (Array.isArray(parsed?.song) && parsed.song.length) {
      for (let i = 0; i < ROWS; i++) {
        const row = parsed.song[i];
        if (Array.isArray(row)) {
          s.song[i] = SONG_COLS.map((_, c) => byteOrNullFromLegacy(row[c]));
        } else {
          const b = byteOrNullFromLegacy(row);
          s.song[i] = SONG_COLS.map((_, c) => (c === 0 ? b : null));
        }
      }
    }
    if (parsed?.chains && typeof parsed.chains === "object") {
      for (const [k, arr] of Object.entries(parsed.chains)) {
        const id = parseInt(k, 10);
        if (!Number.isFinite(id)) continue;
        if (!Array.isArray(arr)) continue;
        s.chains[id] = Array.from({ length: ROWS }, (_, i) => {
          const src = arr[i];
          if (src != null && typeof src === "object") return normalizeChainRow(src);
          const phraseId = byteOrNullFromLegacy(src);
          return { phraseId, tsp: phraseId == null ? null : 0x00 };
        });
      }
    }
    if (parsed?.phrases && typeof parsed.phrases === "object") {
      for (const [k, p] of Object.entries(parsed.phrases)) {
        const id = parseInt(k, 10);
        if (!Number.isFinite(id)) continue;
        if (!p || typeof p !== "object") continue;
        const steps = Array.isArray(p.steps) ? p.steps : null;
        if (!steps) continue;
        s.phrases[id] = {
          steps: Array.from({ length: ROWS }, (_, i) => {
            const src = steps[i] ?? {};
            return {
              note: normalizeNote(src.note) || "",
              instr: normalizeInstr(byteOrNullFromLegacy(src.instr)),
              cmd: cmdByteFromLegacy(src.cmd),
              val: byteOrNullFromLegacy(src.val),
            };
          }),
        };
      }
    }

    // Legacy migration: a single `steps` pattern becomes Phrase 00, with Song -> Chain 00 -> Phrase 00.
    if (Array.isArray(parsed?.steps)) {
      const migrated = Array.from({ length: ROWS }, (_, i) => {
        const src = parsed.steps[i] ?? {};
        return {
          note: normalizeNote(src.note) || "",
          instr: normalizeInstr(byteOrNullFromLegacy(src.instr)),
          cmd: cmdByteFromLegacy(src.cmd),
          val: byteOrNullFromLegacy(src.val),
        };
      });
      s.phrases[0x00] = { steps: migrated };
      s.song = Array.from({ length: ROWS }, () => SONG_COLS.map((_, c) => (c === 0 ? 0x00 : null)));
      s.chains[0x00] = Array.from({ length: ROWS }, () => ({ phraseId: 0x00, tsp: 0x00 }));
    }

    if (Array.isArray(parsed?.instruments)) {
      s.instruments = parsed.instruments;
    }
    ensureInstrumentsInState(s);
    return s;
  } catch {
    return defaultState();
  }
}

function saveState() {
  state.activeInstrumentId = clamp((instrumentTargetIndex | 0) >>> 0, 0, NUM_INSTRUMENTS - 1);
  const persisted = { ...state };
  delete persisted.selectionAnchor;
  delete persisted.selectedRange;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

let state = loadState();

// Selection
let selRow = 0;
let selCol = 1; // default to Note
let isPlaying = false;
let playRow = -1;

/** Bumps on each transport start/stop so deferred playhead callbacks don’t apply after stop. */
let playheadScheduleGen = 0;
/** AudioContext time of first phrase step (for visual playhead from `currentTime - delay`). */
let phrasePlayheadAnchorTime = null;
let phrasePlayheadRafId = 0;

// Modifier tracking
let isZPressed = false;
let isXPressed = false;

// UI elements
const elTracker = document.getElementById("tracker");
const elStatusLeft = document.getElementById("statusLeft");
const elStatusRight = document.getElementById("statusRight");
const elMasterStart = document.getElementById("masterStartBtn");
const elPlay = document.getElementById("playBtn");
const elBpmSettingsBtn = document.getElementById("bpmSettingsBtn");
const elSettingsOverlay = document.getElementById("settingsOverlay");
const elSettingsBpmSlider = document.getElementById("settingsBpmSlider");
const elSettingsBpmVal = document.getElementById("settingsBpmVal");
const elSettingsLatSlider = document.getElementById("settingsLatSlider");
const elSettingsLatVal = document.getElementById("settingsLatVal");
const elSettingsOverlayDone = document.getElementById("settingsOverlayDone");
const elExport = document.getElementById("exportBtn");
const elImportBtn = document.getElementById("importBtn");
const elImportOverlay = document.getElementById("importOverlay");
const elImportOverlayText = document.getElementById("importOverlayText");
const elImportOverlayLoad = document.getElementById("importOverlayLoad");
const elImportOverlayCancel = document.getElementById("importOverlayCancel");
const elReset = document.getElementById("resetBtn");
const elPulse1Width = document.getElementById("pulse1Width");
const elPulse2Width = document.getElementById("pulse2Width");
const elPhraseView = document.getElementById("phraseView");
const elSongView = document.getElementById("songView");
const elChainView = document.getElementById("chainView");
const elInstrumentView = document.getElementById("instrumentView");
const elInstrumentGrid = document.getElementById("instrumentGrid");
const elPlaceholderView = document.getElementById("placeholderView");
const elPlaceholderTitle = document.getElementById("placeholderTitle");
const elNavMap = document.getElementById("navMap");
const elScreenName = document.getElementById("screenName");
const elScreenId = document.getElementById("screenId");
const elWavType = document.getElementById("wavType");
const elNoiseType = document.getElementById("noiseType");
const elMixVol0 = document.getElementById("mixVol0");
const elMixVol1 = document.getElementById("mixVol1");
const elMixVol2 = document.getElementById("mixVol2");
const elMixVol3 = document.getElementById("mixVol3");
const elMixVol0Val = document.getElementById("mixVol0Val");
const elMixVol1Val = document.getElementById("mixVol1Val");
const elMixVol2Val = document.getElementById("mixVol2Val");
const elMixVol3Val = document.getElementById("mixVol3Val");
const elNudgeBar = document.querySelector(".nudge-bar");
const elCellMenuSelect = document.getElementById("cellMenuSelect");

// Audio
let engineReady = false;
let synthPulse1 = null; // OscillatorNode
let synthPulse2 = null; // OscillatorNode
let synthWave = null; // OscillatorNode
let synthNoise = null; // AudioBufferSourceNode
let workletReady = false;
let polyWorklet = null; // AudioWorkletNode (tate-poly), outputs: [PU1, PU2, WAV]
/** Pending worklet voice-steal per channel (prevents stale silenced/timeout from reconnecting the wrong og). */
let oscStealPending = [null, null, null, null];
/** Last scheduled trigger time per channel — keeps automation ordered when Transport callbacks batch late (same safeTime → broken voice-steal). */
let lastTriggerSafeTimeByChannel = [0, 0, 0, 0];
/** Estimated time when the channel gate is near-silent again (used to decide whether to phase-reset poly voice). */
let gateSilentAfterByChannel = [0, 0, 0, 0];
/** Last note string played per channel (for `L` slide from previous step). */
let lastPlayedNoteByChannel = [null, null, null, null];

/** Minimum spacing between triggers on one channel (~one render quantum) so Web Audio automation + voice-steal stay ordered. */
function minAutomationLagSeconds() {
  const sr = audioCtx?.sampleRate;
  if (Number.isFinite(sr) && sr > 0) return 128 / sr;
  return 128 / 48000;
}

function polyParamNameForFreq(ch) {
  const c = clamp(ch | 0, 0, 2);
  return c === 0 ? "freq0" : c === 1 ? "freq1" : "freq2";
}
function polyParamNameForDuty(ch) {
  const c = clamp(ch | 0, 0, 1);
  return c === 0 ? "duty0" : "duty1";
}

function setPolyFreqAtTime(ch, freqHz, time) {
  if (!polyWorklet?.parameters) return;
  const p = polyWorklet.parameters.get(polyParamNameForFreq(ch));
  if (!p?.setValueAtTime) return;
  const f = Math.max(0, Number(freqHz) || 0);
  try { p.setValueAtTime(f, time); } catch { /* ignore */ }
}
function setPolyDutyAtTime(ch, duty, time) {
  if (!polyWorklet?.parameters) return;
  if (ch !== 0 && ch !== 1) return;
  const p = polyWorklet.parameters.get(polyParamNameForDuty(ch));
  if (!p?.setValueAtTime) return;
  const d = clamp(Number(duty) || 0.5, 0.02, 0.98);
  try { p.setValueAtTime(d, time); } catch { /* ignore */ }
}
function setPolyShape(ch, shape) {
  if (!polyWorklet?.port?.postMessage) return;
  try { polyWorklet.port.postMessage({ type: "shape", ch, shape }); } catch { /* ignore */ }
}
function polyNoteOnAtTime(ch, time, attackSamples = 96) {
  if (!polyWorklet?.port?.postMessage) return;
  try { polyWorklet.port.postMessage({ type: "noteOn", ch, time, attackSamples }); } catch { /* ignore */ }
}

function resetPerChannelTriggerSafeTimes() {
  lastTriggerSafeTimeByChannel[0] = 0;
  lastTriggerSafeTimeByChannel[1] = 0;
  lastTriggerSafeTimeByChannel[2] = 0;
  lastTriggerSafeTimeByChannel[3] = 0;
  gateSilentAfterByChannel[0] = 0;
  gateSilentAfterByChannel[1] = 0;
  gateSilentAfterByChannel[2] = 0;
  gateSilentAfterByChannel[3] = 0;
  lastPlayedNoteByChannel[0] = null;
  lastPlayedNoteByChannel[1] = null;
  lastPlayedNoteByChannel[2] = null;
  lastPlayedNoteByChannel[3] = null;
}
let oscGainPulse1 = null; // GainNode (per-osc; used for wiring but no crossfade)
let oscGainPulse2 = null;
let oscGainWave = null;
let panPulse1 = null; // StereoPannerNode
let panPulse2 = null; // StereoPannerNode
let panWave = null; // StereoPannerNode
let panNoise = null; // StereoPannerNode
// Mixer gain (controlled by mixVol)
let gainPulse1 = null; // GainNode
let gainPulse2 = null; // GainNode
let gainWave = null; // GainNode
let gainNoise = null; // GainNode
// Gate gain (controlled by instrument ENV/LENGTH)
let gatePulse1 = null; // GainNode
let gatePulse2 = null; // GainNode
let gateWave = null; // GainNode
let gateNoise = null; // GainNode
// DC blockers (highpass) to suppress clicky transients
let hpPulse1 = null; // BiquadFilterNode
let hpPulse2 = null;
let hpWave = null;
let hpNoise = null;
let master = null; // GainNode
let stepEventId = null;
let audioCtx = null; // raw AudioContext

// Track sustained notes per channel (LENGTH=1F).
const heldNoteByChannel = new Array(4).fill(false);

function safeInstrumentId(v) {
  return clamp((v ?? 0) | 0, 0, NUM_INSTRUMENTS - 1);
}

function getInstrumentById(id) {
  ensureInstrumentsInState(state);
  return state.instruments[safeInstrumentId(id)] ?? defaultInstrumentObject(0);
}

function channelPanner(ch) {
  return ch === 0 ? panPulse1 : ch === 1 ? panPulse2 : ch === 2 ? panWave : panNoise;
}
function channelGain(ch) {
  return ch === 0 ? gatePulse1 : ch === 1 ? gatePulse2 : ch === 2 ? gateWave : gateNoise;
}
function channelSynth(ch) {
  return ch === 0 ? synthPulse1 : ch === 1 ? synthPulse2 : ch === 2 ? synthWave : synthNoise;
}
function channelOscGain(ch) {
  return ch === 0 ? oscGainPulse1 : ch === 1 ? oscGainPulse2 : ch === 2 ? oscGainWave : null;
}

/** Real `BaseAudioContext` for nodes in our graph (Tone transport callbacks may not expose `Tone.getContext().rawContext`). */
function nativeAudioContextFromGraph(node) {
  const n = node || master || panPulse1 || gatePulse1 || panNoise;
  if (n && n.context) return n.context;
  try {
    const tc = typeof Tone !== "undefined" && Tone.getContext ? Tone.getContext() : null;
    if (tc?.rawContext) return tc.rawContext;
  } catch { /* ignore */ }
  return audioCtx;
}

function hardMuteGateAtTime(gate, time) {
  if (!gate?.gain) return;
  try {
    gate.gain.cancelScheduledValues(time);
    gate.gain.setValueAtTime(0, time);
  } catch {
    /* ignore */
  }
}

function fastMuteGateAtTime(gate, time) {
  if (!gate?.gain) return;
  try {
    gate.gain.cancelScheduledValues(time);
    // Avoid instantaneous steps to 0 (click source). Use a fast exponential approach to near-zero.
    const floor = 0.00001;
    if (gate.gain.setTargetAtTime) {
      gate.gain.setTargetAtTime(floor, time, 0.001);
    } else if (gate.gain.exponentialRampToValueAtTime) {
      gate.gain.setValueAtTime(Math.max(floor, gate.gain.value || floor), time);
      gate.gain.exponentialRampToValueAtTime(floor, time + 0.004);
    } else {
      gate.gain.setValueAtTime(0, time);
    }
  } catch {
    /* ignore */
  }
}

function fastMuteAllGatesAtTime(time) {
  fastMuteGateAtTime(gatePulse1, time);
  fastMuteGateAtTime(gatePulse2, time);
  fastMuteGateAtTime(gateWave, time);
  fastMuteGateAtTime(gateNoise, time);
}

function silenceAllGatesOnStop(time) {
  // Stop/pause: ensure we actually reach silence (0), even for sustain instruments.
  // We do it with a short ramp so it doesn't click.
  const gates = [gatePulse1, gatePulse2, gateWave, gateNoise];
  for (const gate of gates) {
    if (!gate?.gain) continue;
    try {
      gate.gain.cancelScheduledValues(time);
      const v = Math.max(0.00001, Number(gate.gain.value) || 0.00001);
      gate.gain.setValueAtTime(v, time);
      gate.gain.exponentialRampToValueAtTime(0.00001, time + 0.015);
      gate.gain.setValueAtTime(0, time + 0.02);
    } catch {
      /* ignore */
    }
  }
}

/** After `og.connect(panner)`, fade output gain 0→1 at *connect time* so a late steal never opens the bus at full level mid-cycle. */
function rampWorkletNoteGainAfterPannerConnect(og) {
  if (!og?.gain) return;
  const ctx = og.context;
  if (!ctx) return;
  const c = ctx.currentTime;
  try {
    og.gain.cancelScheduledValues(c);
  } catch {
    /* ignore */
  }
  try {
    og.gain.setValueAtTime(0, c);
    if (og.gain.linearRampToValueAtTime) og.gain.linearRampToValueAtTime(1.0, c + 0.001);
    else og.gain.setValueAtTime(1.0, c + 0.001);
  } catch {
    /* ignore */
  }
}

/** If playback stops mid–voice-steal, complete wiring so the graph matches synth refs (avoids stuck/clicks on resume). */
function flushPendingOscStealsAtStop() {
  for (let ch = 0; ch < 4; ch++) {
    const p = oscStealPending[ch];
    if (!p) continue;
    try {
      if (p.timerId) window.clearTimeout(p.timerId);
    } catch {
      /* ignore */
    }
    try {
      if (p.oldWorklet?.port) p.oldWorklet.port.onmessage = null;
    } catch {
      /* ignore */
    }
    try {
      p.prevOg.disconnect(p.pan);
    } catch {
      /* ignore */
    }
    try {
      p.og.disconnect();
    } catch {
      /* ignore */
    }
    try {
      p.og.connect(p.pan);
    } catch {
      /* ignore */
    }
    rampWorkletNoteGainAfterPannerConnect(p.og);
    oscStealPending[ch] = null;
  }
}

function hardMuteAllGatesAtTime(time) {
  hardMuteGateAtTime(gatePulse1, time);
  hardMuteGateAtTime(gatePulse2, time);
  hardMuteGateAtTime(gateWave, time);
  hardMuteGateAtTime(gateNoise, time);
}

function waveTypeForInstrumentMode(mode) {
  const m = clamp((mode ?? 0) | 0, 0, 3);
  return m === 0 ? "triangle" : m === 1 ? "sawtooth" : m === 2 ? "square" : "sine";
}

function pulseWidthForInstrumentMode(mode) {
  const m = clamp((mode ?? 0) | 0, 0, 3);
  return m === 0 ? 0.125 : m === 1 ? 0.25 : m === 2 ? 0.5 : 0.75;
}

function stopAndDisconnectNodeAtTime(node, time) {
  if (!node) return;
  // IMPORTANT: do NOT disconnect immediately (JS time) — that can click if the gate is still open.
  // Schedule stop at `time`, then disconnect slightly after `time`.
  // Worklet nodes don't have stop(); they just get disconnected and GC'd.
  try { if (typeof node.stop === "function") node.stop(time); } catch { /* ignore */ }
  try {
    const ctx = node.context;
    const now = ctx?.currentTime ?? 0;
    const ms = Math.max(0, (time - now) * 1000 + 30);
    window.setTimeout(() => { try { node.disconnect(); } catch { /* ignore */ } }, ms);
  } catch {
    /* ignore */
  }
}

function replaceOscillatorForChannelAtTime(channel, instrument, freqHz, time) {
  if (!audioCtx) return null;
  const ch = clamp(channel | 0, 0, 3);
  if (ch === 3) return synthNoise; // noise is separate looping source
  const ins = instrument || defaultInstrumentObject(0);
  const pan = channelPanner(ch);
  if (!pan) return null;

  const now = audioCtx.currentTime;
  const t = Math.max(time, now + 0.001);
  const f = Math.max(0, Number(freqHz) || 0);
  // Prefer worklet oscillator per note: deterministic phase + BLEP smoothing.
  // Fallback to OscillatorNode if the worklet couldn't load (e.g. file://).
  if (!workletReady || typeof AudioWorkletNode !== "function") {
    const osc = audioCtx.createOscillator();
    osc.__debugId = ++audioDebugOscId;
    osc.frequency.setValueAtTime(f, t);
    if (osc.detune) osc.detune.setValueAtTime(0, t);
    if (ch === 0 || ch === 1) {
      osc.type = "sine"; // overridden by PeriodicWave for pulse
      applyPulseWidthAtTime(osc, pulseWidthForInstrumentMode(ins.mode), t);
    } else {
      osc.type = waveTypeForInstrumentMode(ins.mode);
    }
    const og = audioCtx.createGain();
    og.gain.setValueAtTime(0, now);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(1.0, t + 0.001);
    osc.connect(og);
    og.connect(pan);
    osc.start(t);

    const old = ch === 0 ? synthPulse1 : ch === 1 ? synthPulse2 : synthWave;
    const oldG = channelOscGain(ch);
    if (oldG?.gain) {
      try {
        oldG.gain.cancelScheduledValues(t);
        if (oldG.gain.linearRampToValueAtTime) oldG.gain.linearRampToValueAtTime(0.00001, t + 0.0015);
        else oldG.gain.setValueAtTime(0, t);
      } catch { /* ignore */ }
    }
    audioDebugLog({
      where: "oscSwap",
      ch,
      now: fmtTime(now),
      t: fmtTime(t),
      newId: osc.__debugId,
      oldId: old?.__debugId ?? null,
      oldMutedAt: fmtTime(t),
      f,
      mode: ins.mode,
      src: "osc",
    });
    stopAndDisconnectNodeAtTime(old, t + 0.03);
    try {
      const ms = Math.max(0, (t + 0.08 - now) * 1000);
      if (oldG) window.setTimeout(() => { try { oldG.disconnect(); } catch {} }, ms);
    } catch { /* ignore */ }

    if (ch === 0) synthPulse1 = osc;
    else if (ch === 1) synthPulse2 = osc;
    else synthWave = osc;
    if (ch === 0) oscGainPulse1 = og;
    else if (ch === 1) oscGainPulse2 = og;
    else oscGainWave = og;

    return osc;
  }

  // Worklet oscillator path.
  const shape =
    ch === 0 || ch === 1
      ? "pulse"
      : waveTypeForInstrumentMode(ins.mode) === "triangle"
        ? "triangle"
        : waveTypeForInstrumentMode(ins.mode) === "sawtooth"
          ? "saw"
          : waveTypeForInstrumentMode(ins.mode) === "square"
            ? "square"
            : "sine";
  const duty = pulseWidthForInstrumentMode(ins.mode);

  const old = ch === 0 ? synthPulse1 : ch === 1 ? synthPulse2 : synthWave;
  /** Previous note’s output gain (into pan). Used to disconnect before wiring the new voice. */
  const prevOg = channelOscGain(ch);

  let osc;
  try {
    // Must be the same BaseAudioContext as `pan` (Tone often hides `rawContext` during Transport callbacks).
    const ctx = nativeAudioContextFromGraph(pan);
    if (audioDebugTriggerCount < 3) {
      audioDebugLogCritical({
        where: "worklet.ctxCheck",
        ctxType: ctx?.constructor?.name || null,
        ctxTag: ctx ? Object.prototype.toString.call(ctx) : null,
        panCtxSame: !!(pan?.context && ctx && pan.context === ctx),
        hasAudioWorklet: !!ctx?.audioWorklet,
      });
    }
    osc = new AudioWorkletNode(ctx, "tate-osc", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    if (audioDebugTriggerCount < 5) audioDebugLogCritical({ where: "workletNodeMade", ch, t: fmtTime(t) });
  } catch (err) {
    const msg = String(err?.message || err || "Unknown error");
    const ctx = nativeAudioContextFromGraph(pan);
    audioDebugLog({
      where: "workletNodeFail",
      msg,
      ctxType: ctx?.constructor?.name || null,
      ctxTag: ctx ? Object.prototype.toString.call(ctx) : null,
    });
    // Mark worklet unusable for this session and fall back to OscillatorNode.
    workletReady = false;
    return replaceOscillatorForChannelAtTime(channel, instrument, freqHz, time);
  }
  osc.__debugId = ++audioDebugOscId;
  try {
    osc.parameters.get("frequency")?.setValueAtTime(f, t);
    osc.parameters.get("duty")?.setValueAtTime(duty, t);
  } catch { /* ignore */ }
  try {
    // Reset phase and apply a tiny local attack to eliminate start edge clicks.
    osc.port.postMessage({ type: "shape", shape });
    osc.port.postMessage({ type: "reset" });
    osc.port.postMessage({ type: "attack", samples: 96 });
  } catch { /* ignore */ }

  const og = audioCtx.createGain();
  og.gain.setValueAtTime(0, now);
  osc.connect(og);
  // Avoid summing old+new into the same panner (beat / click). Tie new to pan only after old hits a steal cut, or fallback timeout.
  if (old && typeof old.port?.postMessage === "function" && prevOg) {
    // Steal path: keep og at 0 until finishVoiceSteal. Scheduling the audible ramp at note time `t` is unsafe —
    // if silenced/timeout completes late, the ramp is already at 1 when we connect → full bus mid-wave (click).
    const abandon = oscStealPending[ch];
    if (abandon) {
      try {
        if (abandon.timerId) window.clearTimeout(abandon.timerId);
      } catch {
        /* ignore */
      }
      try {
        if (abandon.oldWorklet?.port) abandon.oldWorklet.port.onmessage = null;
      } catch {
        /* ignore */
      }
      try {
        abandon.prevOg.disconnect(pan);
      } catch {
        /* ignore */
      }
      oscStealPending[ch] = null;
    }

    const state = { prevOg, og, pan, oldWorklet: old };
    let stealDone = false;
    const finishVoiceSteal = () => {
      if (stealDone) return;
      if (oscStealPending[ch] !== state) return;
      stealDone = true;
      oscStealPending[ch] = null;
      try {
        if (state.timerId) window.clearTimeout(state.timerId);
      } catch {
        /* ignore */
      }
      try {
        if (state.oldWorklet?.port) state.oldWorklet.port.onmessage = null;
      } catch {
        /* ignore */
      }
      try {
        state.prevOg.disconnect(pan);
      } catch {
        /* ignore */
      }
      try {
        state.og.disconnect();
      } catch {
        /* ignore */
      }
      try {
        state.og.connect(pan);
      } catch {
        /* ignore */
      }
      rampWorkletNoteGainAfterPannerConnect(state.og);
    };
    oscStealPending[ch] = state;
    state.timerId = window.setTimeout(finishVoiceSteal, 80);
    old.port.onmessage = (e) => {
      if (e?.data?.type !== "silenced") return;
      if (oscStealPending[ch] !== state) return;
      finishVoiceSteal();
    };
    try {
      old.port.postMessage({ type: "muteAtNextZero" });
    } catch {
      finishVoiceSteal();
    }
  } else {
    try {
      if (prevOg && prevOg !== og) prevOg.disconnect(pan);
    } catch {
      /* ignore */
    }
    try {
      og.disconnect();
    } catch {
      /* ignore */
    }
    og.connect(pan);
    // First note / no steal: open the bus at the scheduled note time.
    try {
      og.gain.setValueAtTime(0, now);
      og.gain.setValueAtTime(0, t);
      if (og.gain.linearRampToValueAtTime) og.gain.linearRampToValueAtTime(1.0, t + 0.001);
      else og.gain.setValueAtTime(1.0, t + 0.001);
    } catch {
      /* ignore */
    }
  }

  // Swap the global ref and stop old oscillator.
  const oldG = channelOscGain(ch);
  // Old voice: worklet silences itself at next zero — do not step oldG here (that was mid-wave clicks).
  audioDebugLog({
    where: "oscSwap",
    ch,
    now: fmtTime(now),
    t: fmtTime(t),
    newId: osc.__debugId,
    oldId: old?.__debugId ?? null,
    oldMutedAt: fmtTime(t),
    f,
    mode: ins.mode,
    src: "worklet",
    shape,
    duty,
  });
  // Stop/disconnect old osc slightly after swap time.
  stopAndDisconnectNodeAtTime(old, t + 0.03);
  try {
    const ms = Math.max(0, (t + 0.08 - now) * 1000);
    if (oldG) window.setTimeout(() => { try { oldG.disconnect(); } catch {} }, ms);
  } catch { /* ignore */ }

  if (ch === 0) synthPulse1 = osc;
  else if (ch === 1) synthPulse2 = osc;
  else synthWave = osc;
  if (ch === 0) oscGainPulse1 = og;
  else if (ch === 1) oscGainPulse2 = og;
  else oscGainWave = og;

  return osc;
}

function panFromOutput(output) {
  const o = clamp((output ?? 0) | 0, 0, 2);
  if (o === 1) return -1;
  if (o === 2) return 1;
  return 0;
}

function applyInstrumentToChannelAtTime(channel, instrument, time) {
  const ch = clamp(channel | 0, 0, 3);
  const ins = instrument || defaultInstrumentObject(0);

  // Mode -> oscillator/noise type
  if (ch === 0 || ch === 1) {
    const width =
      ins.mode === 0 ? 0.125 :
      ins.mode === 1 ? 0.25 :
      ins.mode === 2 ? 0.5 : 0.75;
    if (polyWorklet) setPolyDutyAtTime(ch, width, time);
    else applyPulseWidthAtTime(ch === 0 ? synthPulse1 : synthPulse2, width, time);
  } else if (ch === 2) {
    const waveType =
      ins.mode === 0 ? "triangle" :
      ins.mode === 1 ? "sawtooth" :
      ins.mode === 2 ? "square" : "sine";
    const syn = synthWave;
    // Worklet path: shape is applied on the *new* node inside replaceOscillator. Mutating the outgoing
    // voice here (even if mode matches) can glitch the tail right before a steal overlap.
    if (polyWorklet) {
      const shape = waveType === "triangle" ? "triangle" : waveType === "sawtooth" ? "saw" : waveType;
      setPolyShape(2, shape);
    } else if (syn && typeof syn.port?.postMessage !== "function") {
      try {
        if (syn.type != null) syn.type = waveType;
      } catch {
        /* ignore */
      }
    }
  } else {
    // Noise flavor not implemented yet for raw buffer noise (future).
  }

  // Output (pan) is set per-trigger from the instrument unless a command overrides timbre.
}

function resetChannelPitchStateAtTime(channel, time) {
  const ch = clamp(channel | 0, 0, 3);
  const synth = channelSynth(ch);
  if (!synth) return;
  try {
    // OscillatorNode path
    if (synth.detune) {
      synth.detune.cancelScheduledValues(time);
      synth.detune.setValueAtTime(0, time);
    }
    if (synth.frequency) {
      synth.frequency.cancelScheduledValues(time);
    }
    // AudioWorkletNode oscillator path
    if (synth.parameters && typeof synth.parameters.get === "function") {
      const pFreq = synth.parameters.get("frequency");
      if (pFreq?.cancelScheduledValues) pFreq.cancelScheduledValues(time);
    }
  } catch {
    /* ignore */
  }
}

function setOscFrequencyAtTime(osc, freqHz, time) {
  if (!osc) return;
  const f = Math.max(0, Number(freqHz) || 0);
  try {
    // OscillatorNode path
    if (osc.frequency) {
      osc.frequency.cancelScheduledValues(time);
      osc.frequency.setValueAtTime(f, time);
      return;
    }
    // AudioWorkletNode oscillator path
    if (osc.parameters && typeof osc.parameters.get === "function") {
      const pFreq = osc.parameters.get("frequency");
      if (pFreq?.cancelScheduledValues) pFreq.cancelScheduledValues(time);
      if (pFreq?.setValueAtTime) pFreq.setValueAtTime(f, time);
    }
  } catch { /* ignore */ }
}

function restartSourceAtTime(_src, _time) {
  // Deprecated: WebAudio OscillatorNode cannot be restarted; we re-create oscillators per note now.
}

function forceChannelReleaseAtTime(channel, time) {
  const ch = clamp(channel | 0, 0, 3);
  const synth = channelSynth(ch);
  if (!synth) return;
  try {
    // With always-running oscillators/noise, there is no synth envelope to release.
    // Gating is handled by the per-channel GainNode.
  } catch {
    /* ignore */
  }
  heldNoteByChannel[ch] = false;
}

function scheduleInstrumentEnvelopeAtTime(channel, instrument, time, lengthSec, gainMul = 1) {
  const ch = clamp(channel | 0, 0, 3);
  const g = channelGain(ch);
  if (!g?.gain) return;
  const ins = instrument || defaultInstrumentObject(0);
  const mul = clamp(Number(gainMul) || 1, 0, 4);
  // Keep attack fast (pluck-friendly) while still click-safe.
  const lookAheadSec = 0.002;
  const attackSec = 0.002;

  // ENV1/2/3 are nibbles in Instrument View.
  const env1 = clamp((ins.env1 ?? 0) | 0, 0, 0x0f);
  const env2 = clamp((ins.env2 ?? 0) | 0, 0, 0x01);
  const env3 = clamp((ins.env3 ?? 0) | 0, 0, 0x0f);
  const initial = clamp((env1 / 15) * mul, 0, 1);
  const fadeOut = env2 === 0;
  // ENV3 speed: 0..F maps to 0..3s.
  const nib = env3;
  const envDurRaw = (nib / 15) * 3.0; // seconds
  const len = Number.isFinite(lengthSec) ? Math.max(0, lengthSec) : Infinity;
  const envDur = Number.isFinite(len) ? Math.min(envDurRaw, len) : envDurRaw;
  const floor = 0.0001;
  const t0 = time + lookAheadSec;
  const tOpen = t0 + attackSec;

  audioDebugLog({
    where: "scheduleEnvelope",
    ch,
    time,
    t0,
    tOpen,
    lengthSec,
    env1: ins.env1,
    env2: ins.env2,
    env3: ins.env3,
    envDurRaw,
    envDur,
  });

  try {
    // Cancel existing automation at the trigger time, then do a click-safe "duck" into the new envelope.
    if (g.gain.cancelScheduledValues) g.gain.cancelScheduledValues(time);
    // NOTE: we avoid forcing an exact value at `t0` (setValueAtTime) because that can become an audible step
    // if the duck hasn't reached `floor` yet. Targets/ramps keep it continuous.
    if (g.gain.setTargetAtTime) g.gain.setTargetAtTime(floor, time, 0.001);
    else if (g.gain.exponentialRampToValueAtTime) g.gain.exponentialRampToValueAtTime(floor, t0);

    const start = Math.max(floor, initial);
    // Approach the intended start level smoothly before the attack ramp.
    if (g.gain.setTargetAtTime) g.gain.setTargetAtTime(start, t0, 0.001);
    if (g.gain.linearRampToValueAtTime) g.gain.linearRampToValueAtTime(start, tOpen);
    else if (g.gain.setValueAtTime) g.gain.setValueAtTime(start, tOpen);
    else g.gain.value = start;

    // ENV2: 0 = Decay (to 0). 1 = Sustain/Rise (hold, or slight up-ramp).
    // ENV3: 0 = no ramp (constant volume).
    if (envDur > 0) {
      if (fadeOut) {
        // Prefer targets over ramps: ramps can become clicky if later automation cancels mid-flight.
        if (g.gain.setTargetAtTime) g.gain.setTargetAtTime(floor, tOpen, Math.max(0.01, envDur / 5));
        else if (g.gain.exponentialRampToValueAtTime) g.gain.exponentialRampToValueAtTime(floor, tOpen + envDur);
        else if (g.gain.linearRampToValueAtTime) g.gain.linearRampToValueAtTime(0, tOpen + envDur);
      } else {
        const upTarget = clamp(start + 0.08 * mul, floor, 1);
        if (g.gain.setTargetAtTime) g.gain.setTargetAtTime(upTarget, tOpen, Math.max(0.01, envDur / 4));
        else if (g.gain.linearRampToValueAtTime) g.gain.linearRampToValueAtTime(upTarget, tOpen + envDur);
      }
    }

    // LENGTH gate: close smoothly near the length boundary.
    if (Number.isFinite(len) && len > 0) {
      // Small tail to avoid a hard click at cutoff.
      const endT = time + len;
      const tailT = Math.max(time, endT - 0.012);
      // IMPORTANT: avoid an instantaneous step-to-zero at endT (click source).
      // We approach near-zero smoothly and keep it there.
      if (g.gain.setTargetAtTime) g.gain.setTargetAtTime(floor, tailT, 0.01);
      else if (g.gain.exponentialRampToValueAtTime) {
        try {
          g.gain.setValueAtTime(Math.max(floor, g.gain.value || floor), tailT);
          g.gain.exponentialRampToValueAtTime(floor, endT);
        } catch { /* ignore */ }
      } else if (g.gain.linearRampToValueAtTime) {
        g.gain.linearRampToValueAtTime(0, endT);
      }
    }
  } catch {
    /* ignore */
  }
}

function lengthSecondsFromInstrument(instrument) {
  const ins = instrument || defaultInstrumentObject(0);
  const L = clamp((ins.length ?? 0) | 0, 0, 31);
  if (L === 0x1f) return Infinity;
  if (L <= 0x00) return 0;
  // Absolute piecewise-linear scale with clear anchors:
  // 01 -> 50ms, 10 -> 1000ms, 1E -> 2000ms.
  const n = clamp(L, 1, 30);
  let ms;
  if (n <= 0x10) {
    // 01..10 => 50..1000
    const t = (n - 1) / 15; // 0..1
    ms = 50 + (1000 - 50) * t;
  } else {
    // 10..1E => 1000..2000
    const t = (n - 0x10) / 14; // 0..1
    ms = 1000 + (2000 - 1000) * t;
  }
  return ms / 1000;
}

function releaseHeldChannelAtTime(channel, time) {
  const ch = clamp(channel | 0, 0, 3);
  if (!heldNoteByChannel[ch]) return;
  // Always-running sources: gate is handled by the GainNode.
  heldNoteByChannel[ch] = false;
}

function releaseAllHeldNotes() {
  const now = Tone.getContext()?.rawContext?.currentTime ?? 0;
  for (let ch = 0; ch < 4; ch++) releaseHeldChannelAtTime(ch, now);
}

// Screens (LSDj-ish map)
const SCREEN_MAP = [
  ["S", "C", "P"],
  ["I", "T", null],
];
const SCREEN_NAMES = {
  S: "Song",
  C: "Chain",
  P: "Phrase",
  I: "Instrument",
  T: "Table",
};
let activeScreen = "S";
let activeChainId = 0x00;
let activePhraseId = 0x00;

let songSelRow = 0;
let songSelCol = 0; // 0..3 => PU1..NOI
let chainSelRow = 0;
let chainSelCol = 0; // 0..1 => PHR/TSP

let instrumentTargetIndex = clamp((state.activeInstrumentId ?? 0) | 0, 0, NUM_INSTRUMENTS - 1);
let instSelRow = 0;
let instSelCol = 1;

let playChainRow = -1;
let playSongRow = -1;
let playMode = "P"; // "P" | "C" | "S"

// Cell clipboard for context menu copy/paste
let cellClipboard = null; // { type: string, value: any }
let isOpeningCellMenuSelect = false;

function resetGhostSelect() {
  if (!elCellMenuSelect) return;
  elCellMenuSelect.style.left = "-100px";
  elCellMenuSelect.style.top = "-100px";
  elCellMenuSelect.style.width = "1px";
  elCellMenuSelect.style.height = "1px";
}

function getSelectedEditCellElement() {
  if (activeScreen === "P") {
    return elTracker?.querySelector(".cell.cell--selected.editcell") ?? null;
  }
  if (activeScreen === "S") {
    return elSongView?.querySelector(".list16__cell.list16__cell--selected.editcell") ?? null;
  }
  if (activeScreen === "C") {
    return elChainView?.querySelector(".list16__cell.list16__cell--selected.editcell") ?? null;
  }
  if (activeScreen === "I") {
    return elInstrumentView?.querySelector(".list16__cell.list16__cell--selected.editcell") ?? null;
  }
  return null;
}

function removeCellChevronsInRoot(root) {
  if (!root) return;
  root.querySelectorAll(".cell-chevron").forEach((n) => n.remove());
}

function syncCellChevronUI() {
  removeCellChevronsInRoot(elTracker);
  removeCellChevronsInRoot(elSongView);
  removeCellChevronsInRoot(elChainView);
  removeCellChevronsInRoot(elInstrumentView);
  const el = getSelectedEditCellElement();
  if (!(el instanceof HTMLElement)) return;
  const ch = document.createElement("span");
  ch.className = "cell-chevron";
  ch.textContent = "▾";
  ch.setAttribute("aria-hidden", "true");
  el.appendChild(ch);
}

/** Park invisible native <select> over the selected edit cell for the active screen. */
function syncGhostSelectToSelection() {
  if (!elCellMenuSelect) return;

  const el = getSelectedEditCellElement();
  if (!(el instanceof HTMLElement)) {
    resetGhostSelect();
    syncCellChevronUI();
    return;
  }

  const r = el.getBoundingClientRect();
  elCellMenuSelect.style.left = `${r.left}px`;
  elCellMenuSelect.style.top = `${r.top}px`;
  elCellMenuSelect.style.width = `${r.width}px`;
  elCellMenuSelect.style.height = `${r.height}px`;
  syncCellChevronUI();
}

function setStatus(msg) {
  elStatusLeft.textContent = msg;
}

function syncPlayButtonUI() {
  if (!elPlay) return;
  elPlay.textContent = isPlaying ? "⏸️" : "▶️";
}

function syncMasterStartButtonUI() {
  if (!elMasterStart) return;
  elMasterStart.classList.toggle("btn--master--live", engineReady);
  elMasterStart.textContent = engineReady ? "🔊" : "🔇";
  elMasterStart.title = engineReady ? "Audio engine on" : "Master Start";
  elMasterStart.setAttribute("aria-label", engineReady ? "Audio engine on" : "Master Start");
}

function viewStatusText() {
  if (activeScreen === "S") return "SONG";
  if (activeScreen === "C") return `CHAIN ${idHex(activeChainId)}`;
  if (activeScreen === "P") return `PHRASE ${idHex(activePhraseId)}`;
  if (activeScreen === "I") return `INST ${idHex(instrumentTargetIndex)}`;
  if (activeScreen === "T") return "TABLE";
  return "--";
}

function setStatusCursor() {
  // Right side is now reserved for View Status (screen + id).
  if (!elStatusRight) return;
  elStatusRight.textContent = viewStatusText();
}

function currentPhrase() {
  const p = state.phrases?.[activePhraseId];
  if (p?.steps && Array.isArray(p.steps) && p.steps.length === ROWS) return p;
  const next = {
    steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })),
  };
  state.phrases[activePhraseId] = next;
  return next;
}

function normalizeInstr(value) {
  if (value == null) return null;
  const v = clamp(value | 0, 0, 255);
  return clamp(v, 0, 31);
}

function displayInstr(value) {
  if (value == null) return "--";
  return toHex2(clamp(value | 0, 0, 31));
}

function phraseStepHasInstrument(step) {
  return step != null && step.instr != null;
}

/** Phrase view: cursor on INST column with a non-empty instrument id (strict drill-down to Instrument). */
function phraseCursorOnFilledInstColumn() {
  return (
    activeScreen === "P" &&
    COLS[selCol]?.key === "instr" &&
    phraseStepHasInstrument(currentPhrase().steps[selRow])
  );
}

function activeInstrumentIdForPhraseEdits() {
  return clamp((state.activeInstrumentId ?? instrumentTargetIndex) | 0, 0, NUM_INSTRUMENTS - 1);
}

/** When a row gains a note from an empty note cell, fill INST from the active instrument if still unset. */
function assignActiveInstrumentOnNewNote(step, prevNoteStr) {
  const had = !!normalizeNote(prevNoteStr);
  const has = !!normalizeNote(step.note);
  if (has && !had && step.instr == null) {
    step.instr = activeInstrumentIdForPhraseEdits();
  }
}

function displayValForStep(step) {
  const cmd = normalizeCmd(step?.cmd);
  if (!cmd) return "--";
  const v = step?.val == null ? 0x00 : clamp(step.val | 0, 0, 255);
  return toHex2(v);
}

function ensureValSemantics(step) {
  const cmd = normalizeCmd(step?.cmd);
  if (!cmd) {
    step.val = null;
    return;
  }
  if (step.val == null) step.val = 0x00;
}

function emptyChainRow() {
  return { phraseId: null, tsp: 0x00 };
}

function normalizeChainRow(row) {
  if (!row || typeof row !== "object") return emptyChainRow();
  const phraseId = row.phraseId == null ? null : clamp(row.phraseId | 0, 0, 255);
  const tsp = row.tsp == null ? 0x00 : clamp((row.tsp ?? 0) | 0, 0, 255);
  return { phraseId, tsp };
}

function signedInt8FromByte(b) {
  const v = clamp((b ?? 0) | 0, 0, 255);
  return v >= 0x80 ? v - 0x100 : v;
}

function tspByteFromSemis(semis) {
  const s = clamp((Number(semis) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
  if (s < 0) return (0x100 + s) & 0xff;
  return s & 0xff;
}

function semisFromTspByte(b) {
  return clamp(signedInt8FromByte(b), TSP_SEMIS_MIN, TSP_SEMIS_MAX);
}

function formatTsp(b) {
  const s = semisFromTspByte(b);
  if (s === 0) return "--";
  const abs = Math.abs(s);
  const hh = abs.toString(16).toUpperCase().padStart(2, "0");
  const sign = s < 0 ? "-" : "+";
  return `${sign}${hh}`;
}

function applyTransposeToNote(note, tspByte) {
  const semis = semisFromTspByte(tspByte);
  return transposeNoteBySemis(note, semis);
}

function renderTracker({ force = false } = {}) {
  if (!force && activeScreen !== "P") return;
  elTracker.innerHTML = "";

  const header = document.createElement("div");
  header.className = "tracker-header";
  for (let c = 0; c < COLS.length; c++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (COLS[c].key !== "row") cell.classList.add("editcell");
    cell.textContent = COLS[c].label;
    header.appendChild(cell);
  }
  elTracker.appendChild(header);

  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div");
    row.className = "tracker-row";
    row.dataset.row = String(r);

    const step = currentPhrase().steps[r];
    // Enforce tracker semantics at render-time (and persist on next edit/save).
    step.instr = normalizeInstr(step.instr);
    ensureValSemantics(step);
    const values = [
      rowHex(r),
      placeholderOrNote(step.note),
      displayInstr(step.instr),
      displayByte(step.cmd, { kind: "cmd" }),
      displayValForStep(step),
    ];

    for (let c = 0; c < COLS.length; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);

      if (COLS[c].key === "row") cell.classList.add("cell--row");
      if (COLS[c].key === "note") {
        cell.classList.add("cell--note");
        if (normalizeNote(step.note) && !phraseStepHasInstrument(step)) cell.classList.add("cell--note-muted");
      }
      if (COLS[c].key === "instr") cell.classList.add("cell--instr");
      if (COLS[c].key === "cmd") cell.classList.add("cell--cmd");
      if (COLS[c].key === "val") cell.classList.add("cell--val");
      if (COLS[c].key !== "row") cell.classList.add("editcell");

      cell.textContent = values[c];
      if (cellInSelectedRange("P", r, c)) cell.classList.add("cell--range-highlight");
      row.appendChild(cell);
    }

    elTracker.appendChild(row);
  }

  applySelectionUI();
  applyPlayheadUI();
}

function renderSongView({ force = false } = {}) {
  if (!elSongView) return;
  if (!force && activeScreen !== "S") return;
  elSongView.innerHTML = "";
  const list = document.createElement("div");
  list.className = "list16 list16--song";

  const header = document.createElement("div");
  header.className = "list16__row list16__row--header";
  header.innerHTML = `
    <div class="list16__cell">Row</div>
    <div class="list16__cell editcell">PU1</div>
    <div class="list16__cell editcell">PU2</div>
    <div class="list16__cell editcell">WAV</div>
    <div class="list16__cell editcell">NOI</div>
  `;
  list.appendChild(header);

  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div");
    row.className = "list16__row";
    if (isPlaying && playMode === "S" && playSongRow === r) row.classList.add("list16__row--playhead");

    const c0 = document.createElement("div");
    c0.className = "list16__cell";
    c0.textContent = rowHex(r);

    row.appendChild(c0);
    const songRow = Array.isArray(state.song?.[r]) ? state.song[r] : SONG_COLS.map((_, c) => (c === 0 ? state.song?.[r] : null));
    for (let c = 0; c < SONG_COLS.length; c++) {
      const cell = document.createElement("div");
      cell.className = "list16__cell editcell";
      const chainId = songRow?.[c] ?? null;
      cell.textContent = slotLabel("chain", chainId);
      cell.dataset.screen = "S";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      if (r === songSelRow && c === songSelCol) cell.classList.add("list16__cell--selected");
      if (cellInSelectedRange("S", r, c)) cell.classList.add("list16__cell--range-highlight");
      row.appendChild(cell);
    }
    list.appendChild(row);
  }
  elSongView.appendChild(list);
  if (activeScreen === "S") syncGhostSelectToSelection();
  renderNavMap();
}

function renderChainView({ force = false } = {}) {
  if (!elChainView) return;
  if (!force && activeScreen !== "C") return;
  elChainView.innerHTML = "";
  const list = document.createElement("div");
  list.className = "list16 list16--chain";

  const header = document.createElement("div");
  header.className = "list16__row list16__row--header";
  header.innerHTML = `
    <div class="list16__cell">Row</div>
    <div class="list16__cell editcell">PHR</div>
    <div class="list16__cell editcell">TSP</div>
  `;
  list.appendChild(header);

  const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
  state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));

  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div");
    row.className = "list16__row";
    if (isPlaying && playMode === "C" && playChainRow === r) row.classList.add("list16__row--playhead");

    const c0 = document.createElement("div");
    c0.className = "list16__cell";
    c0.textContent = rowHex(r);

    const entry = normalizeChainRow(chain[r]);
    const cP = document.createElement("div");
    cP.className = "list16__cell editcell";
    cP.textContent = slotLabel("phrase", entry.phraseId);
    cP.dataset.screen = "C";
    cP.dataset.row = String(r);
    cP.dataset.col = "0";
    if (r === chainSelRow && chainSelCol === 0) cP.classList.add("list16__cell--selected");
    if (cellInSelectedRange("C", r, 0)) cP.classList.add("list16__cell--range-highlight");

    const cT = document.createElement("div");
    cT.className = "list16__cell editcell";
    cT.textContent = formatTsp(entry.tsp);
    cT.dataset.screen = "C";
    cT.dataset.row = String(r);
    cT.dataset.col = "1";
    if (r === chainSelRow && chainSelCol === 1) cT.classList.add("list16__cell--selected");
    if (cellInSelectedRange("C", r, 1)) cT.classList.add("list16__cell--range-highlight");

    row.appendChild(c0);
    row.appendChild(cP);
    row.appendChild(cT);
    list.appendChild(row);
  }
  elChainView.appendChild(list);
  if (activeScreen === "C") syncGhostSelectToSelection();
  renderNavMap();
}

function setActiveScreen(next, { force = false } = {}) {
  if (!next || !SCREEN_NAMES[next]) return;
  const isChange = next !== activeScreen;
  if (!isChange && !force) return;

  if (isChange && next === "I") {
    if (activeScreen === "S" || activeScreen === "C") {
      setStatus("Open Phrase and focus a filled INST cell to edit an instrument.");
      return;
    }
    if (activeScreen === "P") {
      if (!phraseCursorOnFilledInstColumn()) {
        setStatus("Focus a filled INST cell to open Instrument.");
        flashBlockedSelection();
        return;
      }
      const id = normalizeInstr(currentPhrase().steps[selRow].instr);
      instrumentTargetIndex = id;
      state.activeInstrumentId = id;
    }
  }

  activeScreen = next;
  state.selectionAnchor = null;
  state.selectedRange = null;
  resetGhostSelect();

  if (elPhraseView) elPhraseView.classList.toggle("screen--active", activeScreen === "P");
  if (elSongView) elSongView.classList.toggle("screen--active", activeScreen === "S");
  if (elChainView) elChainView.classList.toggle("screen--active", activeScreen === "C");
  if (elInstrumentView) elInstrumentView.classList.toggle("screen--active", activeScreen === "I");

  // Hide placeholder entirely for now (we have real Song/Chain/Phrase)
  if (elPlaceholderView) elPlaceholderView.classList.remove("screen--active");

  // Update playhead visuals if Phrase isn't visible.
  if (activeScreen !== "P") {
    playRow = -1;
  }

  if (elScreenName) elScreenName.textContent = SCREEN_NAMES[activeScreen] ?? "--";
  if (elScreenId) elScreenId.textContent = "--";

  // Refresh UI
  if (activeScreen === "P") {
    renderTracker();
  } else if (activeScreen === "S") {
    renderSongView();
  } else if (activeScreen === "C") {
    renderChainView();
  } else if (activeScreen === "I") {
    renderInstrumentView();
  } else {
    setStatus(`${SCREEN_NAMES[activeScreen]} screen (placeholder).`);
    setStatusCursor();
  }
  if (activeScreen === "P" || activeScreen === "S" || activeScreen === "C" || activeScreen === "I") {
    syncGhostSelectToSelection();
  }
  renderNavMap();
  if (activeScreen === "I") {
    setStatus(instrumentStatusForRow(instSelRow));
  }
}

function renderInstrumentView() {
  if (!elInstrumentGrid) return;
  ensureInstrumentsInState(state);
  elInstrumentGrid.innerHTML = "";
  elInstrumentGrid.className = "list16 list16--instrument";

  const header = document.createElement("div");
  header.className = "list16__row list16__row--header";
  const h0 = document.createElement("div");
  h0.className = "list16__cell";
  h0.textContent = "Param";
  const h1 = document.createElement("div");
  h1.className = "list16__cell";
  h1.textContent = "Val";
  header.appendChild(h0);
  header.appendChild(h1);
  elInstrumentGrid.appendChild(header);

  for (let r = 0; r < INSTRUMENT_PARAM_ROWS; r++) {
    const row = document.createElement("div");
    row.className = "list16__row";
    const cLab = document.createElement("div");
    cLab.className = "list16__cell";
    cLab.textContent = INSTRUMENT_ROW_LABELS[r] ?? "--";
    const cVal = document.createElement("div");
    cVal.className = "list16__cell editcell";
    cVal.dataset.screen = "I";
    cVal.dataset.row = String(r);
    cVal.dataset.col = "1";
    cVal.textContent = displayInstrumentParamCell(r);
    if (r === instSelRow && instSelCol === 1) cVal.classList.add("list16__cell--selected");
    if (cellInSelectedRange("I", r, 1)) cVal.classList.add("list16__cell--range-highlight");
    row.appendChild(cLab);
    row.appendChild(cVal);
    elInstrumentGrid.appendChild(row);
  }

  if (activeScreen === "I") syncGhostSelectToSelection();
  setStatusCursor();
}

function rangeSelectionBlocksDrill() {
  const rng = state.selectedRange;
  return Boolean(rng && rng.screen === activeScreen && (activeScreen === "S" || activeScreen === "C"));
}

function drillDown() {
  if (rangeSelectionBlocksDrill()) {
    setStatus("Clear selection to open Chain or Phrase.");
    return true;
  }
  if (activeScreen === "S") {
    const row = state.song?.[songSelRow];
    const cid = Array.isArray(row) ? row[songSelCol] : (songSelCol === 0 ? row : null);
    if (cid == null) { flashBlockedSelection(); return true; }
    activeChainId = cid;
    if (!state.chains[activeChainId]) state.chains[activeChainId] = Array.from({ length: ROWS }, () => emptyChainRow());
    chainSelRow = 0;
    chainSelCol = 0;
    setActiveScreen("C");
    return true;
  }
  if (activeScreen === "C") {
    const chain = state.chains[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
    const pid = normalizeChainRow(chain[chainSelRow]).phraseId;
    if (pid == null) { flashBlockedSelection(); return true; }
    activePhraseId = pid;
    if (!state.phrases[activePhraseId]) {
      state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };
    }
    selRow = 0;
    selCol = 1;
    setActiveScreen("P");
    return true;
  }
  return false;
}

function drillUp() {
  if (activeScreen === "I") {
    setActiveScreen("P");
    return true;
  }
  if (activeScreen === "P") {
    setActiveScreen("C");
    return true;
  }
  if (activeScreen === "C") {
    setActiveScreen("S");
    return true;
  }
  return false;
}

function renderNavMap() {
  if (!elNavMap) return;

  const onS = activeScreen === "S";
  const onC = activeScreen === "C";
  const onP = activeScreen === "P";
  const onI = activeScreen === "I";
  const onT = activeScreen === "T";

  const rangeBlock = rangeSelectionBlocksDrill();
  const cid = onS ? getSelectedChainIdFromSong() : null;
  const pid = onC ? getSelectedPhraseIdFromChain() : null;

  const chainCellOk = onS && cid != null && !rangeBlock;
  const phraseCellOk = onC && pid != null && !rangeBlock;

  /** Open Chain: strict slot on Song, or any deeper screen (drill-up / context). */
  const chainNavOk = chainCellOk || onC || onP || onI || onT;
  /** Open Phrase: strict PHR on Chain, or Instrument/Table (context), or already on Phrase. */
  const phraseNavOk = phraseCellOk || onP || onI || onT;

  const instrDrillOk = phraseCursorOnFilledInstColumn();

  for (const btn of elNavMap.querySelectorAll(".navmap__btn")) {
    const scr = btn.getAttribute("data-screen");
    btn.classList.toggle("navmap__btn--active", scr != null && scr === activeScreen);
    btn.classList.remove("btn--disabled");
    btn.removeAttribute("aria-disabled");
    btn.disabled = false;

    if (scr === "C") {
      const dead = !chainNavOk;
      if (dead) {
        btn.classList.add("btn--disabled");
        btn.setAttribute("aria-disabled", "true");
        btn.disabled = true;
      }
    } else if (scr === "P") {
      const dead = !phraseNavOk;
      if (dead) {
        btn.classList.add("btn--disabled");
        btn.setAttribute("aria-disabled", "true");
        btn.disabled = true;
      }
    } else if (scr === "I") {
      const dead = !(instrDrillOk || onI);
      if (dead) {
        btn.classList.add("btn--disabled");
        btn.setAttribute("aria-disabled", "true");
        btn.disabled = true;
      }
    }
  }
}

function getSelectedChainIdFromSong() {
  const row = state.song?.[songSelRow];
  return Array.isArray(row) ? row[songSelCol] : (songSelCol === 0 ? row : null);
}

function getSelectedPhraseIdFromChain() {
  const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
  state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
  return normalizeChainRow(state.chains[activeChainId][chainSelRow]).phraseId;
}

function handleNavClick(targetScreen) {
  if (!targetScreen) return;
  if (targetScreen === "S") {
    setActiveScreen("S");
    return;
  }
  if (targetScreen === "C") {
    if (activeScreen === "S") {
      if (state.selectedRange?.screen === "S") {
        setStatus("Clear selection to open Chain.");
        return;
      }
      const cid = getSelectedChainIdFromSong();
      if (cid == null) {
        setStatus("Select a non-empty chain cell to open Chain view.");
        return;
      }
      activeChainId = cid;
      if (!state.chains[activeChainId]) state.chains[activeChainId] = Array.from({ length: ROWS }, () => emptyChainRow());
      setActiveScreen("C");
      return;
    }
    if (activeScreen === "P" || activeScreen === "I" || activeScreen === "T") {
      if (!state.chains[activeChainId]) state.chains[activeChainId] = Array.from({ length: ROWS }, () => emptyChainRow());
      setActiveScreen("C");
      return;
    }
    return;
  }
  if (targetScreen === "P") {
    if (activeScreen === "C") {
      if (state.selectedRange?.screen === "C") {
        setStatus("Clear selection to open Phrase.");
        return;
      }
      const pid = getSelectedPhraseIdFromChain();
      if (pid == null) {
        setStatus("Select a non-empty phrase (PHR) to open Phrase view.");
        return;
      }
      activePhraseId = pid;
      if (!state.phrases[activePhraseId]) {
        state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };
      }
      setActiveScreen("P");
      return;
    }
    if (activeScreen === "I" || activeScreen === "T") {
      if (!state.phrases[activePhraseId]) {
        state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };
      }
      setActiveScreen("P");
      return;
    }
    return;
  }
  if (targetScreen === "I") {
    setActiveScreen("I");
    return;
  }
  if (targetScreen === "T") {
    setActiveScreen("T");
  }
}

function findScreenPos(screen) {
  for (let y = 0; y < SCREEN_MAP.length; y++) {
    for (let x = 0; x < SCREEN_MAP[y].length; x++) {
      if (SCREEN_MAP[y][x] === screen) return { x, y };
    }
  }
  return { x: 2, y: 0 }; // default to Phrase
}

function tryMoveScreen(dx, dy) {
  const pos = findScreenPos(activeScreen);
  const nx = clamp(pos.x + dx, 0, 2);
  const ny = clamp(pos.y + dy, 0, 1);
  const next = SCREEN_MAP[ny]?.[nx] ?? null;
  if (next) setActiveScreen(next);
}

function flashBlockedSelection() {
  let el = null;
  if (activeScreen === "S") {
    el = elSongView?.querySelector(`.list16__cell--selected`);
  } else if (activeScreen === "C") {
    el = elChainView?.querySelector(`.list16__cell--selected`);
  } else if (activeScreen === "P") {
    el = elTracker.querySelector(`.cell[data-row="${selRow}"][data-col="${selCol}"]`);
  } else if (activeScreen === "I") {
    el = elInstrumentView?.querySelector(`.list16__cell.list16__cell--selected`);
  }
  if (!el) return;
  el.classList.add("cell--flash");
  window.setTimeout(() => el?.classList.remove("cell--flash"), 380);
}

function applySelectionUI() {
  if (activeScreen !== "P") return;
  for (const el of elTracker.querySelectorAll(".cell--selected")) {
    el.classList.remove("cell--selected");
  }
  const sel = elTracker.querySelector(`.cell[data-row="${selRow}"][data-col="${selCol}"]`);
  if (sel) sel.classList.add("cell--selected");
  setStatusCursor();
  syncGhostSelectToSelection();
  refreshPhraseEditStatus();
  renderNavMap();
}

function refreshPhraseEditStatus() {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const label = COLS[selCol]?.label ?? "Cell";
  const colKey = COLS[selCol]?.key;
  if (normalizeNote(step.note) && !phraseStepHasInstrument(step)) {
    setStatus(`${label} @ ${rowHex(selRow)} · No instrument assigned — this step will not sound.`);
    return;
  }
  let hint = "";
  if (colKey === "cmd" || colKey === "val") {
    const c = normalizeCmd(step.cmd);
    if (c) hint = ` · ${phraseCmdShortDescription(c)}`;
  }
  setStatus(`${label} @ ${rowHex(selRow)}${hint}.`);
}

function applyPlayheadUI() {
  if (activeScreen !== "P") return;
  for (const el of elTracker.querySelectorAll(".tracker-row--playhead")) {
    el.classList.remove("tracker-row--playhead");
  }
  if (playRow >= 0) {
    const row = elTracker.querySelector(`.tracker-row[data-row="${playRow}"]`);
    if (row) row.classList.add("tracker-row--playhead");
  }
}

function moveSelection(dr, dc) {
  if (activeScreen !== "P") return;
  selRow = (selRow + dr + ROWS) % ROWS;
  // Never allow cursor into Row index column.
  selCol = clamp(selCol + dc, 1, COLS.length - 1);
  applySelectionUI();
}

function moveSongSelection(dr) {
  if (activeScreen !== "S") return;
  songSelRow = (songSelRow + dr + ROWS) % ROWS;
  renderSongView();
  setStatusCursor();
}

function moveSongSelectionCol(dc) {
  if (activeScreen !== "S") return;
  songSelCol = clamp(songSelCol + dc, 0, SONG_COLS.length - 1);
  renderSongView();
  setStatusCursor();
}

function moveChainSelection(dr) {
  if (activeScreen !== "C") return;
  chainSelRow = (chainSelRow + dr + ROWS) % ROWS;
  renderChainView();
  setStatusCursor();
}

function moveChainSelectionCol(dc) {
  if (activeScreen !== "C") return;
  chainSelCol = clamp(chainSelCol + dc, 0, 1);
  renderChainView();
  setStatusCursor();
}

function moveInstrumentSelection(dr, dc) {
  if (activeScreen !== "I") return;
  instSelRow = clamp(instSelRow + dr, 0, INSTRUMENT_PARAM_ROWS - 1);
  instSelCol = clamp(instSelCol + dc, 1, 1);
  renderInstrumentView();
  setStatusCursor();
  setStatus(instrumentStatusForRow(instSelRow));
}

function clearCell() {
  if (activeScreen === "S") {
    const row = state.song?.[songSelRow];
    if (Array.isArray(row)) row[songSelCol] = null;
    else if (songSelCol === 0) state.song[songSelRow] = null;
    saveState();
    renderSongView();
    setStatusCursor();
    setStatus(`Cleared Song ${SONG_COLS[songSelCol]?.key ?? "--"} @ ${rowHex(songSelRow)}.`);
    return;
  }
  if (activeScreen === "C") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
    const entry = normalizeChainRow(chain[chainSelRow]);
    if (chainSelCol === 0) entry.phraseId = null;
    if (chainSelCol === 1) entry.tsp = 0x00;
    state.chains[activeChainId][chainSelRow] = entry;
    saveState();
    renderChainView();
    setStatusCursor();
    setStatus(`Cleared Chain ${idHex(activeChainId)} ${CHAIN_COLS[chainSelCol]?.key ?? "--"} @ ${rowHex(chainSelRow)}.`);
    return;
  }
  if (activeScreen === "I") {
    const pr = clamp(instSelRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
    ensureInstrumentsInState(state);
    const d = defaultInstrumentObject(instrumentTargetIndex);
    if (pr === 0) instrumentTargetIndex = 0;
    else {
      const ins = state.instruments[instrumentTargetIndex];
      if (pr === 1) ins.type = d.type;
      else if (pr === 2) ins.mode = d.mode;
      else if (pr === 3) ins.env1 = d.env1;
      else if (pr === 4) ins.env2 = d.env2;
      else if (pr === 5) ins.env3 = d.env3;
      else if (pr === 6) ins.output = d.output;
      else if (pr === 7) ins.length = d.length;
      else if (pr === 8) ins.tablePreset = d.tablePreset;
      ins.name = instrumentDefaultName(instrumentTargetIndex);
    }
    saveState();
    renderInstrumentView();
    setStatusCursor();
    setStatus(`Cleared ${INSTRUMENT_ROW_LABELS[pr] ?? "param"}.`);
    return;
  }
  if (activeScreen !== "P") return;
  if (selCol === 0) {
    setStatus("Row column is not editable.");
    return;
  }
  const step = currentPhrase().steps[selRow];
  const key = COLS[selCol].key;
  if (key === "note") step.note = "";
  if (key === "instr") step.instr = null;
  if (key === "cmd") { step.cmd = null; step.val = null; }
  if (key === "val") step.val = normalizeCmd(step.cmd) ? 0x00 : null;
  step.instr = normalizeInstr(step.instr);
  ensureValSemantics(step);
  saveState();
  renderTracker();
  setStatus(`Cleared ${COLS[selCol].label} @ ${rowHex(selRow)}.`);
}

function focusMain() {
  // Ensure arrow/space work even if user clicked somewhere
  document.body.focus();
}

const keyState = {
  a: false, // Z
  select: false, // Right shift
};

function wrapByte(v) {
  return ((v % 256) + 256) % 256;
}

function clampByte(v) {
  return clamp((Number(v) || 0) | 0, 0, 255);
}

function applyCmdDeltaToStep(step, deltaSign) {
  const prev = normalizeCmd(step.cmd);
  const cycle = PHRASE_CMD_CYCLE;
  const d = deltaSign > 0 ? 1 : -1;
  let next = null;
  if (d > 0) {
    if (prev == null) next = cycle[0];
    else {
      const i = cycle.indexOf(prev);
      const ii = i < 0 ? 0 : i;
      next = ii >= cycle.length - 1 ? null : cycle[ii + 1];
    }
  } else if (prev == null) {
    next = cycle[cycle.length - 1];
  } else {
    const i = cycle.indexOf(prev);
    const ii = i < 0 ? 0 : i;
    next = ii <= 0 ? cycle[cycle.length - 1] : cycle[ii - 1];
  }
  step.cmd = next;
  ensureValSemantics(step);
}

function nudgeBarSign(action) {
  if (action === "inc" || action === "jump_inc") return 1;
  if (action === "dec" || action === "jump_dec") return -1;
  return 0;
}

/** Map Z+Arrow deltas to nudge-bar actions (single source of truth with UI buttons). */
function nudgeActionFromKeyboardDelta(delta) {
  const d = Number(delta) | 0;
  if (d === 1) return "inc";
  if (d === -1) return "dec";
  if (d === 16) return "jump_inc";
  if (d === -16) return "jump_dec";
  return null;
}

/**
 * LSDj-style wrap on [minV, maxV]: + at max → min, − at min → max. `step` is magnitude (1 or jump size).
 */
function nudgeWrapInt(cur, sign, minV, maxV, step) {
  const st = Math.max(1, Math.abs(step | 0));
  const span = maxV - minV + 1;
  const x = clamp(Number(cur) || 0, minV, maxV);
  const k = x - minV + (sign > 0 ? st : -st);
  return minV + (((k % span) + span) % span);
}

/**
 * One step for nullable 0..maxV: ... → max → `--` → 0 → … ; `−` from `--` or `0` → max (skips `--` going down from 0).
 */
function nudgeNullableByteOnce(cur, dir, maxV) {
  const max = maxV | 0;
  if (dir > 0) {
    if (cur == null) return 0;
    const v = clamp(cur | 0, 0, max);
    if (v >= max) return null;
    return v + 1;
  }
  if (cur == null) return max;
  const v = clamp(cur | 0, 0, max);
  if (v <= 0) return max;
  return v - 1;
}

function nudgeNullableByteSteps(cur, sign, maxV, step) {
  const st = Math.max(1, Math.abs(step | 0));
  const dir = sign > 0 ? 1 : -1;
  let v = cur;
  for (let i = 0; i < st; i++) v = nudgeNullableByteOnce(v, dir, maxV);
  return v;
}

/** Normalize legacy “empty” chain/song bytes to null for nudge math. */
function normalizeEmptyChainSongByte(v) {
  if (v == null || v === 0xff) return null;
  return v | 0;
}

/**
 * One semitone step for phrase notes: B8+ → `--`, `--`+ → lowest note; `--`− → B8; C0− → B8.
 */
function phraseNoteNudgeOnce(noteStr, dir) {
  const empty = !normalizeNote(noteStr);
  if (dir > 0) {
    if (empty) return NOTE_NUDGE_INITIAL;
    const parsed = parseNote(noteStr);
    if (!parsed) return NOTE_NUDGE_INITIAL;
    const n = noteNumberFromParts(parsed);
    if (n >= PHRASE_NOTE_NUM_MAX) return "";
    return makeNote(partsFromNoteNumber(n + 1));
  }
  if (empty) return makeNote(partsFromNoteNumber(PHRASE_NOTE_NUM_MAX));
  const parsed = parseNote(noteStr);
  if (!parsed) return makeNote(partsFromNoteNumber(PHRASE_NOTE_NUM_MAX));
  const n = noteNumberFromParts(parsed);
  if (n <= PHRASE_NOTE_NUM_MIN) return makeNote(partsFromNoteNumber(PHRASE_NOTE_NUM_MAX));
  return makeNote(partsFromNoteNumber(n - 1));
}

function phraseNoteNudgeSteps(noteStr, sign, step) {
  const st = Math.max(1, Math.abs(step | 0));
  const dir = sign > 0 ? 1 : -1;
  let s = noteStr;
  for (let i = 0; i < st; i++) s = phraseNoteNudgeOnce(s, dir);
  return s;
}

/**
 * Transpose nudge with `--` (0 semis) as a stop: … +2F → +30 → -- → -30 → -2F …
 * (see `formatTsp`: 0 displays as `--`).
 */
function transposeTspInc(s) {
  const x = clamp((Number(s) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
  if (x === 0) return TSP_SEMIS_MIN;
  if (x === TSP_SEMIS_MAX) return 0;
  if (x > 0 && x < TSP_SEMIS_MAX) return x + 1;
  if (x === -1) return 1;
  if (x === TSP_SEMIS_MIN) return TSP_SEMIS_MIN + 1;
  if (x < 0 && x > TSP_SEMIS_MIN) return x + 1;
  return x;
}

function transposeTspDec(s) {
  const x = clamp((Number(s) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
  if (x === 0) return TSP_SEMIS_MAX;
  if (x === 1) return -1;
  if (x > 0 && x <= TSP_SEMIS_MAX) return x - 1;
  if (x === TSP_SEMIS_MIN) return 0;
  if (x < 0 && x > TSP_SEMIS_MIN) return x - 1;
  return x;
}

function nudgeTransposeSteps(semis0, sign, step) {
  const st = Math.max(1, Math.abs(step | 0));
  let s = clamp((Number(semis0) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
  const dir = sign > 0 ? 1 : -1;
  for (let i = 0; i < st; i++) {
    s = dir > 0 ? transposeTspInc(s) : transposeTspDec(s);
  }
  return s;
}

/** Song / chain id slots: unset or classic “empty” byte. */
function isEmptySongChainByte(v) {
  return v == null || v === 0xff;
}

function getSongChainIdRaw(row, col) {
  const rr = clamp(row, 0, ROWS - 1);
  const cc = clamp(col, 0, SONG_COLS.length - 1);
  const songRow = state.song?.[rr];
  if (Array.isArray(songRow)) return songRow[cc];
  if (cc === 0) return songRow ?? null;
  return null;
}

function readNormalizedChainRow(row) {
  const rr = clamp(row, 0, ROWS - 1);
  return normalizeChainRow(state.chains?.[activeChainId]?.[rr]);
}

/**
 * True when this grid cell should be treated like `--` for range Random (Phrase / Song / Chain).
 * Chain TSP cells are “empty” when the row has no phrase id (nothing to transpose).
 */
function rangeRandomCellIsEmpty(screen, row, col) {
  if (screen === "S") {
    return isEmptySongChainByte(getSongChainIdRaw(row, col));
  }
  if (screen === "C") {
    const entry = readNormalizedChainRow(row);
    const cc = clamp(col, 0, 1);
    if (cc === 0) return isEmptySongChainByte(entry.phraseId);
    return isEmptySongChainByte(entry.phraseId);
  }
  if (screen === "P") {
    const rr = clamp(row, 0, ROWS - 1);
    const cc = clamp(col, 1, COLS.length - 1);
    const colKey = COLS[cc]?.key;
    const step = currentPhrase().steps[rr];
    if (!colKey || colKey === "row") return true;
    if (colKey === "note") return !normalizeNote(step.note);
    if (colKey === "instr") return step.instr == null;
    if (colKey === "cmd") return normalizeCmd(step.cmd) == null;
    if (colKey === "val") return normalizeCmd(step.cmd) == null;
  }
  return true;
}

function rangeRandomSelectionHasContent(screen, rng) {
  for (let r = rng.r1; r <= rng.r2; r++) {
    for (let c = rng.c1; c <= rng.c2; c++) {
      if (!rangeRandomCellIsEmpty(screen, r, c)) return true;
    }
  }
  return false;
}

function modeLabelForTypeAndMode(type, mode) {
  const t = clamp(type | 0, 0, 2);
  const m = clamp(mode | 0, 0, 3);
  if (t === 0) return PULSE_MODE_LABELS[m];
  if (t === 1) return WAVE_MODE_LABELS[m];
  return NOISE_MODE_LABELS[m];
}

function readInstrumentParamValue(paramRow) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  if (pr === 0) return instrumentTargetIndex;
  ensureInstrumentsInState(state);
  const ins = state.instruments[instrumentTargetIndex];
  if (!ins) return 0;
  if (pr === 1) return ins.type;
  if (pr === 2) return ins.mode;
  if (pr === 3) return ins.env1;
  if (pr === 4) return ins.env2;
  if (pr === 5) return ins.env3;
  if (pr === 6) return ins.length;
  if (pr === 7) return ins.output;
  return ins.tablePreset;
}

function displayInstrumentParamCell(paramRow) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  const v = readInstrumentParamValue(pr);
  if (pr === 0 || pr === 1 || pr === 2 || pr === 6 || pr === 8) return toHex2(clamp(v | 0, 0, 255));
  if (pr === 7) return toHex2(clamp(v | 0, 0, 31));
  return toHex2(clampByte(v));
}

function instrumentStatusForRow(paramRow) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  if (pr === 0) return `Editing Instrument ${idHex(instrumentTargetIndex)}`;
  ensureInstrumentsInState(state);
  const ins = state.instruments[instrumentTargetIndex];
  if (!ins) return "--";
  if (pr === 1) return `Type: ${INSTRUMENT_TYPE_LABELS[clamp(ins.type, 0, 2)]}`;
  if (pr === 2) return `Mode: ${modeLabelForTypeAndMode(ins.type, ins.mode)}`;
  if (pr === 3) return `Initial Volume: ${toHex2(clamp(ins.env1 | 0, 0, 0x0f))}`;
  if (pr === 4) return `Decay (${clamp(ins.env2 | 0, 0, 1)})`;
  if (pr === 5) return `Env Speed: ${toHex2(clamp(ins.env3 | 0, 0, 0x0f))}`;
  if (pr === 6) {
    const L = clamp(ins.length | 0, 0, 31);
    return L === 0x1f ? "Note Length: Unlimited" : `Note Length: ${toHex2(L)}`;
  }
  if (pr === 7) return `Output: ${OUTPUT_LABELS[clamp(ins.output, 0, 2)]}`;
  return `Preset: ${TABLE_PRESET_NAMES[clamp(ins.tablePreset | 0, 0, 11)]}`;
}

function setInstrumentParamFromRaw(paramRow, raw) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  const v = raw == null ? 0 : Number(raw) | 0;
  if (pr === 0) {
    instrumentTargetIndex = clamp(v, 0, NUM_INSTRUMENTS - 1);
    return;
  }
  ensureInstrumentsInState(state);
  const ins = state.instruments[instrumentTargetIndex];
  if (pr === 1) ins.type = clamp(v, 0, 2);
  else if (pr === 2) ins.mode = clamp(v, 0, 3);
  else if (pr === 3) ins.env1 = clamp(v, 0, 0x0f);
  else if (pr === 4) ins.env2 = clamp(v, 0, 0x01);
  else if (pr === 5) ins.env3 = clamp(v, 0, 0x0f);
  else if (pr === 6) ins.length = clamp(v, 0, 31);
  else if (pr === 7) ins.output = clamp(v, 0, 2);
  else ins.tablePreset = clamp(v, 0, 11);
  ins.name = instrumentDefaultName(instrumentTargetIndex);
}

function applyNudgeToInstrumentParam(paramRow, action, isRandom) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  const sign = nudgeBarSign(action);
  const isJump = action.startsWith("jump");
  ensureInstrumentsInState(state);
  const ins = state.instruments[instrumentTargetIndex];
  if (pr === 0) {
    if (isRandom) instrumentTargetIndex = randomInt(0, NUM_INSTRUMENTS - 1);
    else instrumentTargetIndex = nudgeWrapInt(instrumentTargetIndex, sign, 0, NUM_INSTRUMENTS - 1, isJump ? 16 : 1);
    applyLiveInstrumentUpdateForId(instrumentTargetIndex);
    return;
  }
  if (pr === 1) {
    if (isRandom) ins.type = randomInt(0, 2);
    else ins.type = nudgeWrapInt(ins.type, sign, 0, 2, isJump ? 2 : 1);
  } else if (pr === 2) {
    if (isRandom) ins.mode = randomInt(0, 3);
    else ins.mode = nudgeWrapInt(ins.mode, sign, 0, 3, isJump ? 2 : 1);
  } else if (pr === 6) {
    if (isRandom) ins.length = randomInt(0, 31);
    else ins.length = nudgeWrapInt(ins.length, sign, 0, 31, isJump ? 8 : 1);
  } else if (pr === 7) {
    if (isRandom) ins.output = randomInt(0, 2);
    else ins.output = nudgeWrapInt(ins.output, sign, 0, 2, isJump ? 2 : 1);
  } else if (pr === 8) {
    if (isRandom) ins.tablePreset = randomInt(0, 11);
    else ins.tablePreset = nudgeWrapInt(ins.tablePreset, sign, 0, 11, isJump ? 4 : 1);
  } else {
    if (isRandom) {
      if (pr === 3) ins.env1 = randomInt(0, 0x0f);
      else if (pr === 4) ins.env2 = randomInt(0, 0x01);
      else ins.env3 = randomInt(0, 0x0f);
    } else if (pr === 3) ins.env1 = nudgeWrapInt(ins.env1 | 0, sign, 0, 0x0f, isJump ? 4 : 1);
    else if (pr === 4) ins.env2 = nudgeWrapInt(ins.env2 | 0, sign, 0, 0x01, 1);
    else ins.env3 = nudgeWrapInt(ins.env3 | 0, sign, 0, 0x0f, isJump ? 4 : 1);
  }
  ins.name = instrumentDefaultName(instrumentTargetIndex);
  applyLiveInstrumentUpdateForId(instrumentTargetIndex);
}

function applyLiveInstrumentUpdateForId(instrumentId) {
  if (!engineReady) return;
  const id = safeInstrumentId(instrumentId);
  const ins = getInstrumentById(id);
  const t = clamp(ins.type | 0, 0, 2);
  const channels = t === 0 ? [id & 1] : t === 1 ? [2] : [3];
  const now = Tone.getContext()?.rawContext?.currentTime ?? 0;
  for (const ch of channels) {
    applyInstrumentToChannelAtTime(ch, ins, now);
    const p = channelPanner(ch);
    const pan = panFromOutput(ins.output);
    try {
      if (p?.pan?.setValueAtTime) p.pan.setValueAtTime(pan, now);
      else if (p?.pan?.value != null) p.pan.value = pan;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single nudge application for one cell. Buttons use data-nudge:
 * `inc` / `dec` → ±1 semitone (note) or ±1 byte step (hex-ish columns);
 * `jump_inc` / `jump_dec` → ±12 semitones (note) or ±16 (other numeric columns).
 * `random` → randomize that cell’s field.
 */
function applyNudgeToCell(screen, row, col, action, isRandom) {
  if (screen === "I") {
    applyNudgeToInstrumentParam(clamp(row, 0, INSTRUMENT_PARAM_ROWS - 1), action, isRandom);
    return;
  }
  if (screen === "S") {
    const rr = clamp(row, 0, ROWS - 1);
    const cc = clamp(col, 0, SONG_COLS.length - 1);
    const songRow = state.song?.[rr];
    const curRaw = Array.isArray(songRow) ? songRow[cc] : (cc === 0 ? songRow : null);
    const cur = normalizeEmptyChainSongByte(curRaw);
    const sign = nudgeBarSign(action);
    const step = !isRandom && action.startsWith("jump") ? 16 : 1;
    let next;
    if (isRandom) next = randomInt(0, 255);
    else next = nudgeNullableByteSteps(cur, sign, 255, step);
    if (Array.isArray(songRow)) songRow[cc] = next;
    else if (cc === 0) state.song[rr] = next;
    return;
  }

  if (screen === "C") {
    const rr = clamp(row, 0, ROWS - 1);
    const cc = clamp(col, 0, 1);
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((row0) => normalizeChainRow(row0));
    const entry = normalizeChainRow(state.chains[activeChainId][rr]);
    const sign = nudgeBarSign(action);
    const step = !isRandom && action.startsWith("jump") ? 16 : 1;

    if (cc === 0) {
      const cur = normalizeEmptyChainSongByte(entry.phraseId);
      let next;
      if (isRandom) next = randomInt(0, 255);
      else next = nudgeNullableByteSteps(cur, sign, 255, step);
      entry.phraseId = next;
      state.chains[activeChainId][rr] = entry;
      return;
    }

    const startSemis = semisFromTspByte(entry.tsp);
    const nextSemis = isRandom
      ? randomInt(TSP_SEMIS_MIN, TSP_SEMIS_MAX)
      : nudgeTransposeSteps(startSemis, sign, step);
    entry.tsp = tspByteFromSemis(nextSemis);
    state.chains[activeChainId][rr] = entry;
    return;
  }

  if (screen === "P") {
    const rr = clamp(row, 0, ROWS - 1);
    const cc = clamp(col, 1, COLS.length - 1);
    const colKey = COLS[cc]?.key;
    if (!colKey || colKey === "row") return;
    const step = currentPhrase().steps[rr];
    const sign = nudgeBarSign(action);
    const isJump = action.startsWith("jump");

    if (colKey === "note") {
      const prevNote = step.note;
      if (isRandom) {
        const parsed = parseNote(step.note) ?? { idx: 0, octave: 3 };
        step.note = makeNote(
          partsFromNoteNumber(noteNumberFromParts({ idx: randomInt(0, 11), octave: parsed.octave })),
        );
        assignActiveInstrumentOnNewNote(step, prevNote);
        return;
      }
      const st = isJump ? 12 : 1;
      step.note = phraseNoteNudgeSteps(step.note, sign, st);
      assignActiveInstrumentOnNewNote(step, prevNote);
      return;
    }

    if (colKey === "instr") {
      if (isRandom) {
        step.instr = randomInt(0, 31);
        return;
      }
      const st = isJump ? 16 : 1;
      step.instr = nudgeNullableByteSteps(step.instr, sign, 31, st);
      return;
    }

    if (colKey === "cmd") {
      if (isRandom) {
        step.cmd = CMD_ORDER[randomInt(0, CMD_ORDER.length - 1)];
        ensureValSemantics(step);
        return;
      }
      const reps = isJump ? 16 : 1;
      const ds = sign > 0 ? 1 : -1;
      for (let i = 0; i < reps; i++) applyCmdDeltaToStep(step, ds);
      return;
    }

    if (colKey === "val") {
      const stepSz = isJump ? 16 : 1;
      let next;
      if (isRandom) next = randomInt(0, 255);
      else if (normalizeCmd(step.cmd)) {
        const cur = step.val == null ? 0 : clampByte(step.val);
        next = nudgeWrapInt(cur, sign, 0, 255, stepSz);
      } else next = nudgeNullableByteSteps(step.val, sign, 255, stepSz);
      step.val = next;
      ensureValSemantics(step);
    }
  }
}

function nudgeSelectedRange({ action, isRandom, rng }) {
  const screen = rng.screen;
  const isRangeRandom = isRandom && action === "random";

  if (isRangeRandom) {
    if (screen === "I") {
      for (let r = rng.r1; r <= rng.r2; r++) {
        for (let c = rng.c1; c <= rng.c2; c++) {
          applyNudgeToCell(screen, r, c, action, true);
        }
      }
    } else {
      const hasContent = rangeRandomSelectionHasContent(screen, rng);
      for (let r = rng.r1; r <= rng.r2; r++) {
        for (let c = rng.c1; c <= rng.c2; c++) {
          if (!hasContent) {
            if (!(Math.random() < 0.5)) continue;
            applyNudgeToCell(screen, r, c, action, true);
          } else {
            if (rangeRandomCellIsEmpty(screen, r, c)) continue;
            applyNudgeToCell(screen, r, c, action, true);
          }
        }
      }
    }
  } else {
    for (let r = rng.r1; r <= rng.r2; r++) {
      for (let c = rng.c1; c <= rng.c2; c++) {
        applyNudgeToCell(screen, r, c, action, isRandom);
      }
    }
  }
  saveState();
  refreshRangeGridRenders();
  setStatusCursor();
  setStatus(isRangeRandom ? "Randomized selection." : "Nudged selection.");
  return true;
}

function nudgeSelectedCell({ action, isRandom }) {
  if (activeScreen !== "P" && activeScreen !== "S" && activeScreen !== "C" && activeScreen !== "I") {
    return false;
  }

  const rng =
    state.selectedRange && state.selectedRange.screen === activeScreen ? state.selectedRange : null;
  if (rng) {
    return nudgeSelectedRange({ action, isRandom, rng });
  }

  if (activeScreen === "I") {
    applyNudgeToInstrumentParam(instSelRow, action, isRandom);
    saveState();
    refreshRangeGridRenders();
    setStatusCursor();
    setStatus(instrumentStatusForRow(instSelRow));
    return true;
  }

  if (activeScreen === "S") {
    applyNudgeToCell("S", songSelRow, songSelCol, action, isRandom);
    saveState();
    refreshRangeGridRenders();
    setStatusCursor();
    setStatus("Nudged.");
    return true;
  }

  if (activeScreen === "C") {
    applyNudgeToCell("C", chainSelRow, chainSelCol, action, isRandom);
    saveState();
    refreshRangeGridRenders();
    setStatusCursor();
    setStatus("Nudged.");
    return true;
  }

  applyNudgeToCell("P", selRow, selCol, action, isRandom);
  saveState();
  refreshRangeGridRenders();
  setStatusCursor();
  setStatus("Nudged.");
  return true;
}

function applySongHexDelta(delta) {
  if (activeScreen !== "S") return;
  const action = nudgeActionFromKeyboardDelta(delta);
  if (!action) return;
  applyNudgeToCell("S", songSelRow, songSelCol, action, false);
  saveState();
  renderSongView();
  setStatusCursor();
  const row = state.song?.[songSelRow];
  const v = Array.isArray(row) ? row[songSelCol] : (songSelCol === 0 ? row : null);
  setStatus(
    `Song ${SONG_COLS[songSelCol]?.key ?? "--"} @ ${rowHex(songSelRow)} = ${v == null ? "--" : chainLabel(v)}`,
  );
}

function applyChainHexDelta(delta) {
  if (activeScreen !== "C") return;
  const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
  state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
  if (chainSelCol === 0) {
    const action = nudgeActionFromKeyboardDelta(delta);
    if (!action) return;
    applyNudgeToCell("C", chainSelRow, chainSelCol, action, false);
    state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
    const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
    saveState();
    renderChainView();
    setStatusCursor();
    setStatus(
      `Chain ${idHex(activeChainId)} PHR @ ${rowHex(chainSelRow)} = ${entry.phraseId == null ? "--" : phraseLabel(entry.phraseId)}`,
    );
    return;
  }
  const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
  const curSemis = semisFromTspByte(entry.tsp);
  const step = Math.abs(delta) | 0;
  const sign = delta > 0 ? 1 : -1;
  const nextSemis = nudgeTransposeSteps(curSemis, sign, step || 1);
  entry.tsp = tspByteFromSemis(nextSemis);
  state.chains[activeChainId][chainSelRow] = entry;
  saveState();
  renderChainView();
  setStatusCursor();
  setStatus(`Chain ${idHex(activeChainId)} TSP @ ${rowHex(chainSelRow)} = ${formatTsp(entry.tsp)}`);
}

function applyByteDelta(field, delta) {
  if (activeScreen !== "P") return;
  if (field !== "instr" && field !== "val") return;
  const action = nudgeActionFromKeyboardDelta(delta);
  if (!action) return;
  applyNudgeToCell("P", selRow, selCol, action, false);
  const step = currentPhrase().steps[selRow];
  saveState();
  renderTracker();
  if (field === "instr") {
    setStatus(`${COLS[selCol].label} @ ${rowHex(selRow)} = ${displayInstr(step.instr)}`);
  } else {
    const c = normalizeCmd(step.cmd);
    setStatus(
      `${COLS[selCol].label} @ ${rowHex(selRow)} = ${displayByte(step.val, { kind: "hex" })}` +
        (c ? ` · ${phraseCmdShortDescription(c)}` : ""),
    );
  }
}

function applyCmdDelta(delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  applyCmdDeltaToStep(step, delta);
  const next = normalizeCmd(step.cmd);
  saveState();
  renderTracker();
  const help = next ? phraseCmdShortDescription(next) : "";
  setStatus(`Cmd @ ${rowHex(selRow)} = ${next ?? "--"}${help ? ` · ${help}` : ""}`);
}

function cellTypeForGrid(screen, col, rowHint = 0) {
  if (screen === "S") return "song.chainId";
  if (screen === "C") return col === 0 ? "chain.phraseId" : "chain.tsp";
  if (screen === "I") {
    const pr = clamp(rowHint | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
    return `instrument.p${pr}`;
  }
  if (screen === "P") {
    const key = COLS[col]?.key;
    if (key === "note") return "phrase.note";
    if (key === "instr") return "phrase.instr";
    if (key === "cmd") return "phrase.cmd";
    if (key === "val") return "phrase.val";
  }
  return null;
}

function currentCellType() {
  if (activeScreen === "S") return cellTypeForGrid("S", songSelCol, songSelRow);
  if (activeScreen === "C") return cellTypeForGrid("C", chainSelCol, chainSelRow);
  if (activeScreen === "P") return cellTypeForGrid("P", selCol, selRow);
  if (activeScreen === "I") return cellTypeForGrid("I", instSelCol, instSelRow);
  return null;
}

function readCellValueAt(screen, r, c) {
  const irow = screen === "I" ? clamp(r | 0, 0, INSTRUMENT_PARAM_ROWS - 1) : clamp(r | 0, 0, ROWS - 1);
  const type = cellTypeForGrid(screen, c, irow);
  if (!type) return null;

  const mIns = /^instrument\.p(\d+)$/.exec(type);
  if (mIns) {
    const pr = clamp(parseInt(mIns[1], 10), 0, INSTRUMENT_PARAM_ROWS - 1);
    return { type, value: readInstrumentParamValue(pr) };
  }

  const row = irow;

  if (type === "song.chainId") {
    const cc = clamp(c | 0, 0, SONG_COLS.length - 1);
    const songRow = state.song?.[row];
    const cur = Array.isArray(songRow) ? songRow[cc] : (cc === 0 ? songRow : null);
    return { type, value: cur == null ? null : clampByte(cur) };
  }
  if (type === "chain.phraseId") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((x) => normalizeChainRow(x));
    const entry = normalizeChainRow(state.chains[activeChainId][row]);
    return { type, value: entry.phraseId == null ? null : clampByte(entry.phraseId) };
  }
  if (type === "chain.tsp") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((x) => normalizeChainRow(x));
    const entry = normalizeChainRow(state.chains[activeChainId][row]);
    return { type, value: semisFromTspByte(entry.tsp) };
  }
  const step = currentPhrase().steps[row];
  if (type === "phrase.note") return { type, value: normalizeNote(step.note) || "" };
  if (type === "phrase.instr") return { type, value: step.instr == null ? null : normalizeInstr(step.instr) };
  if (type === "phrase.cmd") return { type, value: normalizeCmd(step.cmd) };
  if (type === "phrase.val") return { type, value: step.val == null ? null : clampByte(step.val) };
  return null;
}

function writeCellValueAt(screen, r, c, payload) {
  if (!payload?.type) return false;
  const irow = screen === "I" ? clamp(r | 0, 0, INSTRUMENT_PARAM_ROWS - 1) : clamp(r | 0, 0, ROWS - 1);
  const expected = cellTypeForGrid(screen, c, irow);
  if (payload.type !== expected) return false;

  const mInsW = /^instrument\.p(\d+)$/.exec(expected);
  if (mInsW) {
    const pr = clamp(parseInt(mInsW[1], 10), 0, INSTRUMENT_PARAM_ROWS - 1);
    setInstrumentParamFromRaw(pr, payload.value);
    return true;
  }

  const row = irow;

  if (payload.type === "song.chainId") {
    const cc = clamp(c | 0, 0, SONG_COLS.length - 1);
    const next = payload.value == null ? null : clampByte(payload.value);
    const songRow = state.song?.[row];
    if (Array.isArray(songRow)) songRow[cc] = next;
    else if (cc === 0) state.song[row] = next;
    return true;
  }
  if (payload.type === "chain.phraseId") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((x) => normalizeChainRow(x));
    const entry = normalizeChainRow(state.chains[activeChainId][row]);
    entry.phraseId = payload.value == null ? null : clampByte(payload.value);
    state.chains[activeChainId][row] = entry;
    return true;
  }
  if (payload.type === "chain.tsp") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((x) => normalizeChainRow(x));
    const entry = normalizeChainRow(state.chains[activeChainId][row]);
    const semis = clamp((Number(payload.value) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
    entry.tsp = tspByteFromSemis(semis);
    state.chains[activeChainId][row] = entry;
    return true;
  }
  const step = currentPhrase().steps[row];
  if (payload.type === "phrase.note") {
    const prevNote = step.note;
    step.note = normalizeNote(String(payload.value ?? "")) || "";
    assignActiveInstrumentOnNewNote(step, prevNote);
    return true;
  }
  if (payload.type === "phrase.instr") {
    step.instr = payload.value == null ? null : normalizeInstr(payload.value);
    return true;
  }
  if (payload.type === "phrase.cmd") {
    const prev = normalizeCmd(step.cmd);
    const next = normalizeCmd(payload.value);
    step.cmd = next;
    ensureValSemantics(step);
    return true;
  }
  if (payload.type === "phrase.val") {
    step.val = payload.value == null ? null : clampByte(payload.value);
    ensureValSemantics(step);
    return true;
  }
  return false;
}

function clearCellAt(screen, r, c) {
  const row = clamp(r | 0, 0, ROWS - 1);
  if (screen === "S") {
    const cc = clamp(c | 0, 0, SONG_COLS.length - 1);
    const songRow = state.song?.[row];
    if (Array.isArray(songRow)) songRow[cc] = null;
    else if (cc === 0) state.song[row] = null;
    return;
  }
  if (screen === "C") {
    const cc = clamp(c | 0, 0, 1);
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((x) => normalizeChainRow(x));
    const entry = normalizeChainRow(state.chains[activeChainId][row]);
    if (cc === 0) entry.phraseId = null;
    if (cc === 1) entry.tsp = 0x00;
    state.chains[activeChainId][row] = entry;
    return;
  }
  if (screen === "I") {
    const pr = clamp(r | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
    ensureInstrumentsInState(state);
    const d = defaultInstrumentObject(instrumentTargetIndex);
    if (pr === 0) instrumentTargetIndex = 0;
    else {
      const ins = state.instruments[instrumentTargetIndex];
      if (pr === 1) ins.type = d.type;
      else if (pr === 2) ins.mode = d.mode;
      else if (pr === 3) ins.env1 = d.env1;
      else if (pr === 4) ins.env2 = d.env2;
      else if (pr === 5) ins.env3 = d.env3;
      else if (pr === 6) ins.output = d.output;
      else if (pr === 7) ins.length = d.length;
      else if (pr === 8) ins.tablePreset = d.tablePreset;
      ins.name = instrumentDefaultName(instrumentTargetIndex);
    }
    return;
  }
  if (screen === "P") {
    const cc = clamp(c | 0, 1, COLS.length - 1);
    const step = currentPhrase().steps[row];
    const key = COLS[cc].key;
    if (key === "note") step.note = "";
    if (key === "instr") step.instr = null;
    if (key === "cmd") {
      step.cmd = null;
      step.val = null;
    }
    if (key === "val") step.val = normalizeCmd(step.cmd) ? 0x00 : null;
    step.instr = normalizeInstr(step.instr);
    ensureValSemantics(step);
  }
}

function cellInSelectedRange(screen, r, c) {
  const rng = state.selectedRange;
  if (!rng || rng.screen !== screen) return false;
  return r >= rng.r1 && r <= rng.r2 && c >= rng.c1 && c <= rng.c2;
}

/** Inclusive rectangle `{ r1, c1, r2, c2 }` with `r1 <= r2`, `c1 <= c2`. */
function normalizeSelectedRangeRect(screen, ar, ac, br, bc) {
  let r1 = Math.min(ar, br);
  let r2 = Math.max(ar, br);
  let c1 = Math.min(ac, bc);
  let c2 = Math.max(ac, bc);
  const rMax = screen === "I" ? INSTRUMENT_PARAM_ROWS - 1 : ROWS - 1;
  r1 = clamp(r1, 0, rMax);
  r2 = clamp(r2, 0, rMax);
  if (screen === "S") {
    c1 = clamp(c1, 0, SONG_COLS.length - 1);
    c2 = clamp(c2, 0, SONG_COLS.length - 1);
  } else if (screen === "C") {
    c1 = clamp(c1, 0, 1);
    c2 = clamp(c2, 0, 1);
  } else if (screen === "I") {
    c1 = clamp(c1, 1, 1);
    c2 = clamp(c2, 1, 1);
  } else if (screen === "P") {
    c1 = clamp(c1, 1, COLS.length - 1);
    c2 = clamp(c2, 1, COLS.length - 1);
  }
  return { screen, r1, c1, r2, c2 };
}

function refreshRangeGridRenders() {
  if (activeScreen === "P") renderTracker({ force: true });
  else if (activeScreen === "S") renderSongView({ force: true });
  else if (activeScreen === "C") renderChainView({ force: true });
  else if (activeScreen === "I") renderInstrumentView();
  renderNavMap();
}

function clearTransientGridSelection() {
  state.selectedRange = null;
  state.selectionAnchor = null;
  refreshRangeGridRenders();
}

function getGridTouchRoot(screen) {
  if (screen === "P") return elTracker;
  if (screen === "S") return elSongView?.querySelector(".list16") ?? null;
  if (screen === "C") return elChainView?.querySelector(".list16") ?? null;
  if (screen === "I") return elInstrumentGrid;
  return null;
}

/**
 * Map viewport coords to a grid edit cell using each cell's `getBoundingClientRect()`
 * (accounts for scroll, headers, and transforms inside the grid container).
 */
function gridCellHitFromClient(screen, clientX, clientY) {
  const root = getGridTouchRoot(screen);
  if (!(root instanceof HTMLElement)) return null;
  const bounds = root.getBoundingClientRect();
  if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
    return null;
  }

  let selector;
  if (screen === "P") {
    selector = ".tracker-row .cell.editcell";
  } else if (screen === "I") {
    selector = ".list16--instrument .list16__row:not(.list16__row--header) .list16__cell.editcell";
  } else {
    selector = ".list16__row:not(.list16__row--header) .list16__cell.editcell";
  }

  const cells = root.querySelectorAll(selector);
  for (const cell of cells) {
    if (!(cell instanceof HTMLElement)) continue;
    if (screen === "S" && cell.dataset.screen !== "S") continue;
    if (screen === "C" && cell.dataset.screen !== "C") continue;
    if (screen === "I" && cell.dataset.screen !== "I") continue;
    const rect = cell.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    if (screen === "P" && c === 0) continue;
    return { row: r, col: c };
  }
  return null;
}

function buildRangeClipboard(rng) {
  const rows = [];
  for (let r = rng.r1; r <= rng.r2; r++) {
    const row = [];
    for (let c = rng.c1; c <= rng.c2; c++) {
      row.push(readCellValueAt(rng.screen, r, c));
    }
    rows.push(row);
  }
  return {
    kind: "range",
    screen: rng.screen,
    w: rng.c2 - rng.c1 + 1,
    h: rng.r2 - rng.r1 + 1,
    rows,
  };
}

/** Paste a copied block with top-left at the current single-selected edit cell (clipped to grid). */
function pasteRangeAtCursor(clip) {
  if (!clip || clip.kind !== "range") return false;
  if (clip.screen !== activeScreen) {
    setStatus("Paste blocked (screen mismatch).");
    return false;
  }
  let r0;
  let c0;
  if (activeScreen === "P") {
    r0 = selRow;
    c0 = selCol;
    if (c0 < 1) {
      setStatus("Select an edit cell to paste.");
      return false;
    }
  } else if (activeScreen === "S") {
    r0 = songSelRow;
    c0 = songSelCol;
  } else if (activeScreen === "C") {
    r0 = chainSelRow;
    c0 = chainSelCol;
  } else if (activeScreen === "I") {
    r0 = instSelRow;
    c0 = instSelCol;
  } else {
    return false;
  }

  let n = 0;
  for (let i = 0; i < clip.h; i++) {
    for (let j = 0; j < clip.w; j++) {
      const r = r0 + i;
      const c = c0 + j;
      const rMax = clip.screen === "I" ? INSTRUMENT_PARAM_ROWS - 1 : ROWS - 1;
      if (r < 0 || r > rMax) continue;
      if (clip.screen === "P" && (c < 1 || c > COLS.length - 1)) continue;
      if (clip.screen === "S" && (c < 0 || c > SONG_COLS.length - 1)) continue;
      if (clip.screen === "C" && (c < 0 || c > 1)) continue;
      if (clip.screen === "I" && (c !== 1 || r < 0 || r > INSTRUMENT_PARAM_ROWS - 1)) continue;
      const payload = clip.rows[i][j];
      if (!payload) continue;
      if (writeCellValueAt(clip.screen, r, c, payload)) n++;
    }
  }
  if (!n) {
    setStatus("Paste blocked (block does not fit here).");
    return false;
  }
  saveState();
  refreshRangeGridRenders();
  setStatusCursor();
  setStatus("Pasted block.");
  return true;
}

function clearCellsInRange(rng) {
  if (!rng) return;
  for (let r = rng.r1; r <= rng.r2; r++) {
    for (let c = rng.c1; c <= rng.c2; c++) {
      clearCellAt(rng.screen, r, c);
    }
  }
  saveState();
  refreshRangeGridRenders();
  setStatusCursor();
  setStatus("Cleared range.");
}

function handleGridTouchStart(e) {
  if (e.touches.length >= 2) {
    e.preventDefault();
    e.stopPropagation();
  }

  const screen =
    e.currentTarget === elTracker ? "P" :
    e.currentTarget === elSongView ? "S" :
    e.currentTarget === elChainView ? "C" :
    e.currentTarget === elInstrumentGrid ? "I" : null;
  if (!screen || screen !== activeScreen) return;

  if (e.touches.length >= 2) {
    let anchor = state.selectionAnchor;
    if (!anchor || anchor.screen !== screen) {
      const t0 = e.touches[0];
      const hit0 = gridCellHitFromClient(screen, t0.clientX, t0.clientY);
      if (!hit0) return;
      anchor = { screen, row: hit0.row, col: hit0.col };
      state.selectionAnchor = anchor;
    }

    const t1 = e.touches[1];
    const hit1 = gridCellHitFromClient(screen, t1.clientX, t1.clientY);
    if (!hit1) return;

    state.selectedRange = normalizeSelectedRangeRect(screen, anchor.row, anchor.col, hit1.row, hit1.col);
    refreshRangeGridRenders();
    if (screen === "I") setStatus(instrumentStatusForRow(instSelRow));
    return;
  }

  if (e.touches.length === 1) {
    state.selectedRange = null;
    const t = e.touches[0];
    const hit = gridCellHitFromClient(screen, t.clientX, t.clientY);
    if (!hit) return;
    if (screen === "I") {
      instSelRow = clamp(hit.row, 0, INSTRUMENT_PARAM_ROWS - 1);
      instSelCol = 1;
    }
    const prev = state.selectionAnchor;
    const sameCell =
      prev &&
      prev.screen === screen &&
      prev.row === hit.row &&
      prev.col === hit.col;
    if (!sameCell) {
      state.selectionAnchor = { screen, row: hit.row, col: hit.col };
    }
    refreshRangeGridRenders();
    if (screen === "I") setStatus(instrumentStatusForRow(instSelRow));
  }
}

function handleGridTouchMove(e) {
  if (e.touches.length >= 2) {
    e.preventDefault();
  }
  const screen =
    e.currentTarget === elTracker ? "P" :
    e.currentTarget === elSongView ? "S" :
    e.currentTarget === elChainView ? "C" :
    e.currentTarget === elInstrumentGrid ? "I" : null;
  if (!screen || screen !== activeScreen) return;
}

function readCurrentCellValue() {
  if (activeScreen === "S") return readCellValueAt("S", songSelRow, songSelCol);
  if (activeScreen === "C") return readCellValueAt("C", chainSelRow, chainSelCol);
  if (activeScreen === "P") return readCellValueAt("P", selRow, selCol);
  if (activeScreen === "I") return readCellValueAt("I", instSelRow, instSelCol);
  return null;
}

function writeCurrentCellValue({ type, value }) {
  if (!type) return false;

  if (activeScreen === "I" && /^instrument\.p\d+$/.test(type)) {
    if (writeCellValueAt("I", instSelRow, instSelCol, { type, value })) {
      saveState();
      renderInstrumentView();
      setStatusCursor();
      setStatus(instrumentStatusForRow(instSelRow));
      return true;
    }
    return false;
  }

  if (type === "song.chainId") {
    const row = state.song?.[songSelRow];
    const next = value == null ? null : clampByte(value);
    if (Array.isArray(row)) row[songSelCol] = next;
    else if (songSelCol === 0) state.song[songSelRow] = next;
    saveState();
    renderSongView({ force: true });
    setStatusCursor();
    setStatus(`Set CHAIN = ${next == null ? "--" : idHex(next)}`);
    return true;
  }

  if (type === "chain.phraseId") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
    const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
    entry.phraseId = value == null ? null : clampByte(value);
    state.chains[activeChainId][chainSelRow] = entry;
    saveState();
    renderChainView({ force: true });
    setStatusCursor();
    setStatus(`Set PHR = ${entry.phraseId == null ? "--" : idHex(entry.phraseId)}`);
    return true;
  }

  if (type === "chain.tsp") {
    const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
    state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
    const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
    const semis = clamp((Number(value) || 0) | 0, TSP_SEMIS_MIN, TSP_SEMIS_MAX);
    entry.tsp = tspByteFromSemis(semis);
    state.chains[activeChainId][chainSelRow] = entry;
    saveState();
    renderChainView({ force: true });
    setStatusCursor();
    setStatus(`Set TSP = ${formatTsp(entry.tsp)}`);
    return true;
  }

  // Phrase
  const step = currentPhrase().steps[selRow];
  if (type === "phrase.note") {
    const prevNote = step.note;
    step.note = normalizeNote(String(value ?? "")) || "";
    assignActiveInstrumentOnNewNote(step, prevNote);
    saveState();
    renderTracker({ force: true });
    setStatus(`Set NOTE = ${step.note || "--"}`);
    return true;
  }
  if (type === "phrase.instr") {
    step.instr = value == null ? null : normalizeInstr(value);
    saveState();
    renderTracker({ force: true });
    setStatus(`Set INST = ${displayInstr(step.instr)}`);
    return true;
  }
  if (type === "phrase.cmd") {
    const prev = normalizeCmd(step.cmd);
    const next = normalizeCmd(value);
    step.cmd = next;
    ensureValSemantics(step);
    saveState();
    renderTracker({ force: true });
    const help = next ? phraseCmdShortDescription(next) : "";
    setStatus(`Set CMD = ${next ?? "--"}${help ? ` · ${help}` : ""}`);
    return true;
  }
  if (type === "phrase.val") {
    step.val = value == null ? null : clampByte(value);
    ensureValSemantics(step);
    saveState();
    renderTracker({ force: true });
    const c = normalizeCmd(step.cmd);
    setStatus(
      `Set VAL = ${displayValForStep(step)}` + (c ? ` · ${phraseCmdShortDescription(c)}` : ""),
    );
    return true;
  }
  return false;
}

function clearCurrentCell() {
  clearCell();
  setStatusCursor();
}

function getSelectedCellElement() {
  if (activeScreen === "P") {
    return elTracker.querySelector(`.cell[data-row="${selRow}"][data-col="${selCol}"]`);
  }
  if (activeScreen === "S") {
    return elSongView?.querySelector(`.list16__cell.list16__cell--selected`);
  }
  if (activeScreen === "C") {
    return elChainView?.querySelector(`.list16__cell.list16__cell--selected`);
  }
  if (activeScreen === "I") {
    return elInstrumentView?.querySelector(`.list16__cell.list16__cell--selected`);
  }
  return null;
}

function applyNoteSemitoneDelta(delta) {
  if (activeScreen !== "P") return;
  const d = Number(delta) || 0;
  const action = d > 0 ? "inc" : "dec";
  if (d === 0) return;
  applyNudgeToCell("P", selRow, selCol, action, false);
  const step = currentPhrase().steps[selRow];
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${placeholderOrNote(step.note)}`);
}

function applyNoteOctaveDelta(delta) {
  if (activeScreen !== "P") return;
  const d = Number(delta) || 0;
  const action = d > 0 ? "jump_inc" : "jump_dec";
  if (d === 0) return;
  applyNudgeToCell("P", selRow, selCol, action, false);
  const step = currentPhrase().steps[selRow];
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${placeholderOrNote(step.note)}`);
}

function applyNoteDelta({ pitchDelta = 0, octaveDelta = 0 }) {
  if (activeScreen !== "P") return;
  const net = (Number(pitchDelta) || 0) + 12 * (Number(octaveDelta) || 0);
  if (net === 0) return;
  const abs = Math.abs(net);
  const jumpSteps = Math.floor(abs / 12);
  const rem = abs % 12;
  const sign = net > 0 ? 1 : -1;
  for (let i = 0; i < jumpSteps; i++) {
    applyNudgeToCell("P", selRow, selCol, sign > 0 ? "jump_inc" : "jump_dec", false);
  }
  for (let i = 0; i < rem; i++) {
    applyNudgeToCell("P", selRow, selCol, sign > 0 ? "inc" : "dec", false);
  }
  const step = currentPhrase().steps[selRow];
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${placeholderOrNote(step.note)}`);
}

function handleArrowWithA(key) {
  if (activeScreen !== "P") return false;
  const colKey = COLS[selCol]?.key;
  if (colKey === "row") return false;

  if (colKey === "note") {
    if (key === "ArrowUp") { applyNoteOctaveDelta(1); return true; }
    if (key === "ArrowDown") { applyNoteOctaveDelta(-1); return true; }
    if (key === "ArrowRight") { applyNoteSemitoneDelta(1); return true; }
    if (key === "ArrowLeft") { applyNoteSemitoneDelta(-1); return true; }
    return false;
  }

  if (colKey === "cmd") {
    if (key === "ArrowUp") { applyCmdDelta(1); return true; }
    if (key === "ArrowDown") { applyCmdDelta(-1); return true; }
    if (key === "ArrowRight") { applyCmdDelta(1); return true; }
    if (key === "ArrowLeft") { applyCmdDelta(-1); return true; }
    return false;
  }

  // Instr/Val: byte inc/dec
  const field = colKey;
  if (field !== "instr" && field !== "val") return false;

  if (key === "ArrowUp") { applyByteDelta(field, 1); return true; }
  if (key === "ArrowDown") { applyByteDelta(field, -1); return true; }
  if (key === "ArrowRight") { applyByteDelta(field, 16); return true; }
  if (key === "ArrowLeft") { applyByteDelta(field, -16); return true; }
  return false;
}

function applyBpmFromSlider() {
  if (!elSettingsBpmSlider) return;
  const bpm = clamp(parseInt(elSettingsBpmSlider.value, 10) || 120, BPM_RANGE_MIN, BPM_RANGE_MAX);
  state.bpm = bpm;
  if (elSettingsBpmVal) elSettingsBpmVal.textContent = String(bpm);
  saveState();
  if (engineReady) Tone.Transport.bpm.value = bpm;
  setStatus(`BPM = ${bpm}.`);
}

function applyVisualOffsetFromSlider() {
  if (!elSettingsLatSlider) return;
  const ms = clamp(parseInt(elSettingsLatSlider.value, 10) || 0, 0, 500);
  state.visualOffsetMs = ms;
  if (elSettingsLatVal) elSettingsLatVal.textContent = String(ms);
  saveState();
}

function syncSettingsFormFromState() {
  if (elSettingsBpmSlider) {
    const b = clamp(state.bpm ?? 120, BPM_RANGE_MIN, BPM_RANGE_MAX);
    elSettingsBpmSlider.value = String(b);
    if (elSettingsBpmVal) elSettingsBpmVal.textContent = String(b);
  }
  if (elSettingsLatSlider) {
    const ms = clamp(Number(state.visualOffsetMs) || 0, 0, 500);
    elSettingsLatSlider.value = String(ms);
    if (elSettingsLatVal) elSettingsLatVal.textContent = String(ms);
  }
}

function showSettingsOverlay() {
  if (!elSettingsOverlay) return;
  syncSettingsFormFromState();
  elSettingsOverlay.removeAttribute("hidden");
  elSettingsOverlay.setAttribute("aria-hidden", "false");
}

function hideSettingsOverlay() {
  if (!elSettingsOverlay) return;
  elSettingsOverlay.setAttribute("hidden", "");
  elSettingsOverlay.setAttribute("aria-hidden", "true");
}

function stopPhrasePlayheadRaf() {
  if (phrasePlayheadRafId) {
    cancelAnimationFrame(phrasePlayheadRafId);
    phrasePlayheadRafId = 0;
  }
  phrasePlayheadAnchorTime = null;
}

function phrasePlayheadRafLoop() {
  phrasePlayheadRafId = 0;
  if (!isPlaying || playMode !== "P") return;
  updatePhrasePlayheadFromVisualTime();
  phrasePlayheadRafId = requestAnimationFrame(phrasePlayheadRafLoop);
}

function startPhrasePlayheadRafLoop() {
  stopPhrasePlayheadRaf();
  phrasePlayheadRafId = requestAnimationFrame(phrasePlayheadRafLoop);
}

/**
 * Playhead time aligned with what the user hears:
 * totalDelay = audioCtx.outputLatency + state.visualOffsetMs/1000; visualTime = audioCtx.currentTime - totalDelay.
 */
function updatePhrasePlayheadFromVisualTime() {
  const raw = Tone.getContext()?.rawContext;
  if (!raw || phrasePlayheadAnchorTime == null) return;
  const totalDelay = getTotalPlayheadDelaySeconds();
  const visualTime = raw.currentTime - totalDelay;
  const stepDur = Tone.Time("16n").toSeconds();
  const elapsed = Math.max(0, visualTime - phrasePlayheadAnchorTime);
  const k = Math.floor(elapsed / stepDur + 1e-9);
  const row = k % ROWS;
  if (playRow !== row) {
    playRow = row;
    applyPlayheadUI();
  }
}

function applyPulseWidth(which, pct) {
  const p = clamp(Number(pct) || 50, 5, 95) / 100;
  const synth = which === 1 ? synthPulse1 : synthPulse2;
  if (!synth) return;
  if (synth?.width?.value != null) synth.width.value = p;
  if (synth?.width != null && typeof synth.width === "number") synth.width = p;
}

/** Tone 14's `getContext().rawContext` is a Tone wrapper, not a browser `BaseAudioContext` — `AudioWorkletNode` rejects it. Bind Tone to a native context first. */
function bindToneToNativeAudioContext() {
  try {
    const AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC || typeof Tone === "undefined" || typeof Tone.Context !== "function" || typeof Tone.setContext !== "function") return;
    const native = new AC();
    try {
      Tone.setContext(new Tone.Context({ context: native }));
    } catch {
      Tone.setContext(new Tone.Context(native));
    }
  } catch (err) {
    audioDebugLog({ where: "toneBindNativeFail", msg: String(err?.message || err) });
  }
}

async function masterStart() {
  if (engineReady) return;
  bindToneToNativeAudioContext();
  await Tone.start();

  const raw = Tone.getContext()?.rawContext;
  if (!raw) throw new Error("No AudioContext");
  audioCtx = raw;
  audioDebugLog({ where: "masterStart.begin", href: window.location.href, ctxState: raw.state });
  audioDebugLog({
    where: "masterStart.ctx",
    rawTag: Object.prototype.toString.call(raw),
    hasWorklet: !!audioCtx?.audioWorklet,
    isNativeCtx:
      (typeof BaseAudioContext !== "undefined" && raw instanceof BaseAudioContext) ||
      (typeof window !== "undefined" && window.AudioContext && raw instanceof window.AudioContext) ||
      (typeof window !== "undefined" && window.webkitAudioContext && raw instanceof window.webkitAudioContext),
  });
  if (!workletReady && raw.audioWorklet) {
    try {
      // Worklet modules are fetched like scripts; make the URL explicit so relative paths resolve.
      const url = new URL("./worklet-poly.js", window.location.href);
      // Cache-bust: worklet modules are aggressively cached by some browsers.
      url.searchParams.set("v", BUILD_TAG);
      await raw.audioWorklet.addModule(url);
      workletReady = true;
      audioDebugLog({ where: "workletLoadOk", module: "worklet-poly.js" });
    } catch (err) {
      // If the app is opened via file://, most browsers disallow worklet module loads.
      workletReady = false;
      const msg = String(err?.message || err || "Unknown error");
      audioDebugLog({ where: "workletLoadFail", msg, href: window.location.href });
      // Non-fatal: fall back to OscillatorNode path.
    }
  }
  master = raw.createGain();
  master.gain.value = 0.9;
  master.connect(raw.destination);

  gainPulse1 = raw.createGain();
  gainPulse2 = raw.createGain();
  gainWave = raw.createGain();
  gainNoise = raw.createGain();
  gainPulse1.gain.value = 0.9;
  gainPulse2.gain.value = 0.9;
  gainWave.gain.value = 0.9;
  gainNoise.gain.value = 0.9;
  gainPulse1.connect(master);
  gainPulse2.connect(master);
  gainWave.connect(master);
  gainNoise.connect(master);

  // Gate nodes start at 0 so sources are silent until sequenced.
  gatePulse1 = raw.createGain();
  gatePulse2 = raw.createGain();
  gateWave = raw.createGain();
  gateNoise = raw.createGain();
  gatePulse1.gain.value = 0;
  gatePulse2.gain.value = 0;
  gateWave.gain.value = 0;
  gateNoise.gain.value = 0;
  // DC blockers after gate to reduce clicks on oscillator swaps / sharp edges.
  const mkHp = () => {
    const hp = raw.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 28; // ~DC blocker
    hp.Q.value = 0.707;
    return hp;
  };
  hpPulse1 = mkHp();
  hpPulse2 = mkHp();
  hpWave = mkHp();
  hpNoise = mkHp();

  gatePulse1.connect(hpPulse1);
  gatePulse2.connect(hpPulse2);
  gateWave.connect(hpWave);
  gateNoise.connect(hpNoise);
  hpPulse1.connect(gainPulse1);
  hpPulse2.connect(gainPulse2);
  hpWave.connect(gainWave);
  hpNoise.connect(gainNoise);

  panPulse1 = raw.createStereoPanner();
  panPulse2 = raw.createStereoPanner();
  panWave = raw.createStereoPanner();
  panNoise = raw.createStereoPanner();
  panPulse1.pan.value = 0;
  panPulse2.pan.value = 0;
  panWave.pan.value = 0;
  panNoise.pan.value = 0;
  panPulse1.connect(gatePulse1);
  panPulse2.connect(gatePulse2);
  panWave.connect(gateWave);
  panNoise.connect(gateNoise);

  // Initial melodic sources.
  synthPulse1 = null;
  synthPulse2 = null;
  synthWave = null;

  // Noise: looping buffer source.
  const noiseBuf = raw.createBuffer(1, raw.sampleRate, raw.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  synthNoise = raw.createBufferSource();
  synthNoise.buffer = noiseBuf;
  synthNoise.loop = true;

  // Melodic source gains: for poly worklet, these are fixed wiring nodes.
  oscGainPulse1 = raw.createGain();
  oscGainPulse2 = raw.createGain();
  oscGainWave = raw.createGain();
  oscGainPulse1.gain.value = 1.0;
  oscGainPulse2.gain.value = 1.0;
  oscGainWave.gain.value = 1.0;

  // Prefer a single polyphonic worklet (PU1/PU2/WAV) to avoid any per-note node swaps.
  polyWorklet = null;
  if (workletReady && typeof AudioWorkletNode === "function") {
    try {
      polyWorklet = new AudioWorkletNode(raw, "tate-poly", {
        numberOfInputs: 0,
        numberOfOutputs: 3,
        outputChannelCount: [1, 1, 1],
      });
      audioDebugLogCritical({ where: "polyWorkletMade", ok: true });
      // Default shapes
      setPolyShape(0, "pulse");
      setPolyShape(1, "pulse");
      setPolyShape(2, "sine");
      // Wire outputs → per-channel gains → panners
      polyWorklet.connect(oscGainPulse1, 0, 0);
      polyWorklet.connect(oscGainPulse2, 1, 0);
      polyWorklet.connect(oscGainWave, 2, 0);
    } catch (err) {
      polyWorklet = null;
      const msg = String(err?.message || err || "Unknown error");
      audioDebugLogCritical({ where: "polyWorkletMade", ok: false, msg });
      // If this fails, we’ll fall back to OscillatorNode path at trigger time.
      workletReady = false;
    }
  }
  oscGainPulse1.connect(panPulse1);
  oscGainPulse2.connect(panPulse2);
  oscGainWave.connect(panWave);
  synthNoise.connect(panNoise);

  synthNoise.start();

  // Apply saved UI settings
  Tone.Transport.bpm.value = state.bpm;
  applyInstrumentSettingsFromState();

  engineReady = true;
  resetPerChannelTriggerSafeTimes();
  audioDebugLog({ where: "masterStart.ready", workletReady });
  syncMasterStartButtonUI();
  setStatus("Audio engine ready. Space to play.");
}

function applyInstrumentSettingsFromState() {
  // WAV / NOI
  // Wave type is set per-trigger for channel 2.
  // Noise type is selected by regenerating the noise buffer in masterStart only.

  // Mixer (0..100 -> 0..1)
  const vols = Array.isArray(state.mixVol) ? state.mixVol : [90, 90, 90, 90];
  const g0 = clamp((vols[0] ?? 90) / 100, 0, 1);
  const g1 = clamp((vols[1] ?? 90) / 100, 0, 1);
  const g2 = clamp((vols[2] ?? 90) / 100, 0, 1);
  const g3 = clamp((vols[3] ?? 90) / 100, 0, 1);
  if (gainPulse1?.gain) gainPulse1.gain.value = g0;
  if (gainPulse2?.gain) gainPulse2.gain.value = g1;
  if (gainWave?.gain) gainWave.gain.value = g2;
  if (gainNoise?.gain) gainNoise.gain.value = g3;
}

function instrToChannel(instrHex) {
  const idx = instrHex == null ? 0 : clamp(instrHex | 0, 0, 31);
  ensureInstrumentsInState(state);
  const t = state.instruments[idx]?.type ?? 0;
  if (t === 0) return idx & 1; // Pulse → alternate PU1 / PU2
  if (t === 1) return 2; // Wave
  return 3; // Noise
}

function widthFromByte(valByte) {
  const v = valByte == null ? 0x02 : clamp(valByte | 0, 0, 255);
  const code = v & 0x03;
  if (code === 0x00) return 0.125;
  if (code === 0x01) return 0.25;
  if (code === 0x02) return 0.5;
  return 0.75;
}

function applyPulseWidthAtTime(osc, width, time) {
  // WebAudio OscillatorNode has no pulse width; we emulate PWM via PeriodicWave.
  if (!osc || !osc.setPeriodicWave) return;
  const w = clamp(Number(width) || 0.5, 0.02, 0.98);
  const ctx = osc.context;
  // Pulse wave Fourier series: a_n = (2 / (nπ)) * sin(nπw)
  const harmonics = 64;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    const a = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * w);
    imag[n] = a;
    real[n] = 0;
  }
  try {
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    osc.setPeriodicWave(wave);
  } catch {
    /* ignore */
  }
}

function transposeNoteBySemis(note, semis) {
  try {
    return Tone.Frequency(note).transpose(semis);
  } catch {
    return note;
  }
}

function phraseNoteToString(noteOrFreq) {
  if (noteOrFreq == null) return "";
  if (typeof noteOrFreq === "string") return noteOrFreq;
  try {
    if (typeof noteOrFreq.toNote === "function") return noteOrFreq.toNote();
  } catch { /* ignore */ }
  try {
    return Tone.Frequency(noteOrFreq).toNote();
  } catch {
    return String(noteOrFreq);
  }
}

function phraseCmdShortDescription(cmd) {
  switch (cmd) {
    case "C": return "Chord: each tick cycles root + two semitone offsets (high/low nibbles).";
    case "D": return "Delay: wait VAL ticks before opening the gate (6 ticks per step).";
    case "E": return "Envelope: Pulse/Noise ENV override; Wave gain from low 2 bits (0/25/50/100%).";
    case "L": return "Slide: linear pitch from previous step’s note to this note.";
    case "P": return "Pitch bend: signed byte per tick (80–FF negative), cumulative in semitone steps.";
    case "R": return "Retrig: repeat hit every low-nibble ticks; high nibble = hit level.";
    case "S": return "Sweep: Pulse/Wave frequency sweep; Noise shifts playback rate.";
    case "V": return "Vibrato: high nibble rate, low nibble depth (semitone table).";
    case "W": return "Wave: Pulse duty or Wave shape from low bits.";
    default: return "";
  }
}

function phraseTickBoundarySec(safeTime, stepDurSec, tickIdx) {
  const k = clamp(tickIdx | 0, 0, TICKS_PER_STEP);
  return safeTime + (k / TICKS_PER_STEP) * stepDurSec;
}

function resetCmdModulationAtTime(channel, time) {
  resetChannelPitchStateAtTime(channel, time);
  const ch = clamp(channel | 0, 0, 3);
  if (polyWorklet?.parameters && ch >= 0 && ch <= 2) {
    try {
      const p = polyWorklet.parameters.get(polyParamNameForFreq(ch));
      if (p?.cancelScheduledValues) p.cancelScheduledValues(time);
    } catch { /* ignore */ }
  }
  if (ch === 3 && synthNoise?.playbackRate) {
    try {
      if (synthNoise.playbackRate.cancelScheduledValues) synthNoise.playbackRate.cancelScheduledValues(time);
      synthNoise.playbackRate.setValueAtTime(1, time);
    } catch { /* ignore */ }
  }
}

function applyCmdEnvelopeOverride(instrument, cmd, valByte) {
  let waveGainMul = 1;
  if (cmd !== "E" || valByte == null) return { instrument, waveGainMul };
  const ins = instrument || defaultInstrumentObject(0);
  const v = clamp(valByte | 0, 0, 255);
  if (ins.type === 1) {
    const c = v & 0x03;
    waveGainMul = c === 0 ? 0 : c === 1 ? 0.25 : c === 2 ? 0.5 : 1;
    return { instrument: ins, waveGainMul };
  }
  const env1 = (v >> 4) & 0x0f;
  const lo = v & 0x0f;
  const env2 = (lo >> 3) & 0x01;
  const env3 = clamp(((lo & 0x07) << 1) | 0x01, 0, 0x0f);
  return {
    instrument: { ...ins, env1, env2, env3 },
    waveGainMul: 1,
  };
}

function retrigPulseAtTime(channel, t, volNib) {
  const peak = clamp(volNib / 15, 0.05, 1);
  const tAudio = t + POLY_LOOKAHEAD_SEC;
  const og = channelOscGain(channel);
  if (og?.gain?.setValueAtTime) {
    try {
      og.gain.cancelScheduledValues(tAudio);
      og.gain.setValueAtTime(peak, tAudio);
      og.gain.exponentialRampToValueAtTime(1, tAudio + 0.06);
    } catch { /* ignore */ }
  } else {
    const gn = channelGain(channel);
    if (gn?.gain?.linearRampToValueAtTime) {
      try {
        gn.gain.linearRampToValueAtTime(peak, tAudio + 0.004);
      } catch { /* ignore */ }
    }
  }
  if (polyWorklet && workletReady) {
    const ch = clamp(channel | 0, 0, 2);
    polyNoteOnAtTime(ch, tAudio, 72);
  }
}

function triggerStep(step, time, stepDurSec, opts = {}) {
  if (!step) return;
  const transposeSemis = Number.isFinite(opts.transposeSemis) ? opts.transposeSemis : 0;
  const cmd = normalizeCmd(step.cmd);
  const valByte = step.val;
  const hasInstr = phraseStepHasInstrument(step);
  const hasNote = !!normalizeNote(step.note);

  if (!hasInstr) return;

  const tickAudioNow = Number.isFinite(opts.tickAudioNow)
    ? opts.tickAudioNow
    : (Tone.getContext()?.rawContext?.currentTime ?? time);

  const instrumentId = clamp(step.instr | 0, 0, 31);
  const instrument = getInstrumentById(instrumentId);
  const channel = Number.isFinite(opts.channelOverride) ? clamp(opts.channelOverride | 0, 0, 3) : instrToChannel(instrumentId);

  if (!hasNote) {
    const okEmpty = cmd === "D" || cmd === "R" || cmd === "E" || (cmd === "S" && channel === 3);
    if (!okEmpty) return;
  }

  let synth = channelSynth(channel);
  // Poly worklet drives PU1/PU2/WAV; per-channel OscillatorNodes stay null in that mode.
  const usesPolyMelodic = polyWorklet && workletReady && channel >= 0 && channel <= 2;
  if (!synth && channel !== 3 && !usesPolyMelodic) return;

  const panner =
    channel === 0 ? panPulse1 :
    channel === 1 ? panPulse2 :
    channel === 2 ? panWave :
    panNoise;

  const now = tickAudioNow;
  const chSafe = clamp(channel | 0, 0, 3);
  const minSafe = Math.max(time, now + 0.004);
  const lag = minAutomationLagSeconds();
  const prevSafe = lastTriggerSafeTimeByChannel[chSafe];
  let safeTime = Math.max(minSafe, prevSafe + lag);
  if (safeTime > minSafe + 1e-10) {
    audioDebugLog({
      where: "triggerStep.safeTimeOrdered",
      channel: chSafe,
      transportTime: time,
      now,
      minSafe,
      prevSafe,
      lag,
      safeTime,
    });
  }
  lastTriggerSafeTimeByChannel[chSafe] = safeTime;
  const g = channelGain(channel);

  if (audioTimingDebugEnabled()) {
    const envLookAheadSec = POLY_LOOKAHEAD_SEC + 0.002;
    const orderBumpSec = Math.max(0, safeTime - minSafe);
    audioTimingLog({
      where: "triggerStep.timing",
      ch: chSafe,
      transportT: fmtTime(time),
      audioNowT: fmtTime(now),
      skewAudioMinusTransportMs: Math.round((now - time) * 1000),
      minSafeT: fmtTime(minSafe),
      safeT: fmtTime(safeTime),
      slipGridMs: Math.round((safeTime - time) * 1000),
      marginNowPlus4msMs: Math.round((minSafe - time) * 1000),
      orderBumpMs: Math.round(orderBumpSec * 1000),
      minVoiceLagMs: Math.round(lag * 1000),
      gateOpensAboutMsAfterTransport: Math.round((safeTime + envLookAheadSec - time) * 1000),
      outLatMs: Math.round(getOutputLatencySeconds() * 1000),
      uiOffsetMs: Number(state.visualOffsetMs) || 0,
      note: step.note || "--",
      cmd,
      songCol: Number.isFinite(opts.channelOverride) ? opts.channelOverride : null,
    });
  }

  if (audioDebugTriggerCount < 5) {
    audioDebugLogCritical({
      where: "triggerStep.critical",
      n: audioDebugTriggerCount,
      now,
      time,
      safeTime,
      note: step.note || "--",
      cmd,
      instrumentId,
      channel,
      workletReady,
      gate: !!g,
    });
  }
  audioDebugTriggerCount++;

  audioDebugLog({
    where: "triggerStep",
    now,
    time,
    safeTime,
    dtMs: Math.round((safeTime - now) * 1000),
    channel,
    cmd,
    note: step.note || "--",
    instrumentId,
    instrument: {
      type: instrument.type,
      mode: instrument.mode,
      env1: instrument.env1,
      env2: instrument.env2,
      env3: instrument.env3,
      output: instrument.output,
      length: instrument.length,
    },
  });

  resetCmdModulationAtTime(channel, safeTime);
  forceChannelReleaseAtTime(channel, safeTime);

  const { instrument: envSourceIns, waveGainMul } = applyCmdEnvelopeOverride(instrument, cmd, valByte);

  applyInstrumentToChannelAtTime(channel, instrument, safeTime);

  const nextPan = panFromOutput(instrument.output);
  if (panner?.pan?.setValueAtTime) panner.pan.setValueAtTime(nextPan, safeTime);
  else if (panner?.pan?.value != null) panner.pan.value = nextPan;

  const lenSec = lengthSecondsFromInstrument(envSourceIns);

  let noteStartSafe = safeTime;
  let delayTicks = 0;
  if (cmd === "D") {
    delayTicks = clamp(valByte == null ? 0 : valByte | 0, 0, TICKS_PER_STEP);
    if (delayTicks >= TICKS_PER_STEP) return;
    noteStartSafe = phraseTickBoundarySec(safeTime, stepDurSec, delayTicks);
  }

  scheduleInstrumentEnvelopeAtTime(
    channel,
    envSourceIns,
    noteStartSafe,
    lenSec === Infinity ? Infinity : lenSec,
    waveGainMul,
  );

  try {
    const chGate = clamp(channel | 0, 0, 3);
    if (!Number.isFinite(lenSec) || lenSec === Infinity) gateSilentAfterByChannel[chGate] = Infinity;
    else gateSilentAfterByChannel[chGate] = noteStartSafe + Math.max(0, lenSec) + 0.03;
  } catch { /* ignore */ }

  if (cmd === "R") {
    const lo = valByte == null ? 0 : valByte & 0x0f;
    const period = lo | 0;
    if (period > 0) {
      const volNib = (valByte >> 4) & 0x0f;
      for (let k = period; k < TICKS_PER_STEP; k += period) {
        retrigPulseAtTime(channel, phraseTickBoundarySec(safeTime, stepDurSec, k), volNib);
      }
    }
  }

  const isNoise = channel === 3;

  if (isNoise) {
    if (lenSec === Infinity) heldNoteByChannel[3] = true;
    else heldNoteByChannel[3] = false;

    if (cmd === "S") {
      const curRate = synthNoise?.playbackRate?.value ?? 1;
      const signed = signedInt8FromByte(valByte);
      const target = clamp(curRate * Math.pow(2, signed / 48), 0.25, 4);
      const t0 = phraseTickBoundarySec(safeTime, stepDurSec, 0) + POLY_LOOKAHEAD_SEC;
      const t1 = phraseTickBoundarySec(safeTime, stepDurSec, TICKS_PER_STEP - 1) + POLY_LOOKAHEAD_SEC;
      try {
        if (synthNoise?.playbackRate?.setValueAtTime) {
          synthNoise.playbackRate.cancelScheduledValues(t0);
          synthNoise.playbackRate.setValueAtTime(curRate, t0);
          synthNoise.playbackRate.linearRampToValueAtTime(target, t1);
        }
      } catch { /* ignore */ }
    }

    if (hasNote) {
      const baseNoteStr = transposeSemis !== 0 ? transposeNoteBySemis(step.note, transposeSemis) : step.note;
      let baseFreq;
      try {
        baseFreq = Tone.Frequency(baseNoteStr).toFrequency();
      } catch {
        return;
      }
      const neutral = 440;
      const scheduleNoiseRate = (k, freqHz) => {
        const t = phraseTickBoundarySec(safeTime, stepDurSec, k) + POLY_LOOKAHEAD_SEC;
        const r = clamp(freqHz / neutral, 0.25, 4);
        try {
          if (synthNoise?.playbackRate?.setValueAtTime) {
            if (k === 0) synthNoise.playbackRate.cancelScheduledValues(t);
            synthNoise.playbackRate.setValueAtTime(r, t);
          }
        } catch { /* ignore */ }
      };

      if (cmd === "C") {
        const v = valByte == null ? 0 : valByte | 0;
        const x = (v >> 4) & 0x0f;
        const y = v & 0x0f;
        const offs = [0, x, y];
        for (let k = 0; k < TICKS_PER_STEP; k++) {
          const fq = Tone.Frequency(transposeNoteBySemis(baseNoteStr, offs[k % 3])).toFrequency();
          scheduleNoiseRate(k, fq);
        }
      } else if (cmd === "L") {
        const f1 = baseFreq;
        const prev = lastPlayedNoteByChannel[3];
        let f0 = f1;
        if (prev) {
          try { f0 = Tone.Frequency(transposeNoteBySemis(prev, transposeSemis)).toFrequency(); } catch { /* ignore */ }
        }
        for (let k = 0; k < TICKS_PER_STEP; k++) {
          const a = TICKS_PER_STEP <= 1 ? 1 : k / (TICKS_PER_STEP - 1);
          scheduleNoiseRate(k, f0 + (f1 - f0) * a);
        }
      } else if (cmd === "P") {
        let f = baseFreq;
        for (let k = 0; k < TICKS_PER_STEP; k++) {
          scheduleNoiseRate(k, f);
          const st = signedInt8FromByte(valByte) / 16;
          f *= Math.pow(2, st / 12);
        }
      } else if (cmd === "V") {
        const rateHz = 4 + (((valByte ?? 0) >> 4) & 0x0f) * 0.65;
        const depth = VIBRATO_DEPTH_SEMITONES[(valByte ?? 0) & 0x0f];
        for (let k = 0; k < TICKS_PER_STEP; k++) {
          const tSec = (k / TICKS_PER_STEP) * stepDurSec;
          const lfo = Math.sin(2 * Math.PI * rateHz * tSec);
          const fq = baseFreq * Math.pow(2, (depth * lfo) / 12);
          scheduleNoiseRate(k, fq);
        }
      } else if (cmd !== "S") {
        scheduleNoiseRate(0, baseFreq);
      }

      lastPlayedNoteByChannel[3] = phraseNoteToString(baseNoteStr);
    }
    return;
  }

  if (!hasNote) return;

  if (lenSec <= 0) return;

  const baseNoteStr = transposeSemis !== 0 ? transposeNoteBySemis(step.note, transposeSemis) : step.note;
  let baseFreq;
  try {
    baseFreq = Tone.Frequency(baseNoteStr).toFrequency();
  } catch {
    return;
  }

  const firstTick = delayTicks;
  const polyTime0 = phraseTickBoundarySec(safeTime, stepDurSec, firstTick) + POLY_LOOKAHEAD_SEC;

  if (polyWorklet && workletReady && channel >= 0 && channel <= 2) {
    if (channel === 0 || channel === 1) {
      setPolyShape(channel, "pulse");
      const duty =
        cmd === "W" ? widthFromByte(valByte) : pulseWidthForInstrumentMode(instrument.mode);
      setPolyDutyAtTime(channel, duty, polyTime0);
    } else if (channel === 2) {
      if (cmd === "W") {
        const mode = valByte == null ? 0 : valByte & 0x03;
        const waveType =
          mode === 0 ? "triangle" :
          mode === 1 ? "sawtooth" :
          mode === 2 ? "square" : "sine";
        const shape = waveType === "triangle" ? "triangle" : waveType === "sawtooth" ? "saw" : waveType;
        setPolyShape(2, shape);
      } else {
        const waveType = waveTypeForInstrumentMode(instrument.mode);
        const shape = waveType === "triangle" ? "triangle" : waveType === "sawtooth" ? "saw" : waveType === "square" ? "square" : "sine";
        setPolyShape(2, shape);
      }
    }
  } else if (channel === 0 || channel === 1) {
    const duty = cmd === "W" ? widthFromByte(valByte) : pulseWidthForInstrumentMode(instrument.mode);
    applyPulseWidthAtTime(channel === 0 ? synthPulse1 : synthPulse2, duty, phraseTickBoundarySec(safeTime, stepDurSec, firstTick));
  }

  const setMelodicFreq = (k, freqHz, synthRef) => {
    const tickT = phraseTickBoundarySec(safeTime, stepDurSec, k);
    if (polyWorklet && workletReady && channel >= 0 && channel <= 2) {
      setPolyFreqAtTime(channel, freqHz, tickT + POLY_LOOKAHEAD_SEC);
    } else if (channel <= 2) {
      if (k === 0) {
        const next = replaceOscillatorForChannelAtTime(channel, instrument, freqHz, tickT);
        if (next) synth = next;
      }
      setOscFrequencyAtTime(synthRef || synth, freqHz, tickT);
    }
  };

  if (polyWorklet && workletReady && channel >= 0 && channel <= 2) {
    const silentAfter = gateSilentAfterByChannel[clamp(channel | 0, 0, 3)];
    const willReset =
      silentAfter === Infinity ? false : (Number.isFinite(silentAfter) ? polyTime0 >= silentAfter : true);
    if (willReset) polyNoteOnAtTime(channel, polyTime0, 96);
    audioDebugLog({ where: "pitchSet.poly", channel, baseNote: baseNoteStr, freq: baseFreq, safeTime, polyTime: polyTime0, willReset, silentAfter });
  }

  const applyDefaultConstantPitch = () => {
    for (let k = 0; k < TICKS_PER_STEP; k++) setMelodicFreq(k, baseFreq, synth);
  };

  if (!cmd || cmd === "E" || cmd === "D" || cmd === "R" || cmd === "W") {
    applyDefaultConstantPitch();
  } else if (cmd === "C") {
    const v = valByte == null ? 0 : valByte | 0;
    const x = (v >> 4) & 0x0f;
    const y = v & 0x0f;
    const names = [baseNoteStr, transposeNoteBySemis(baseNoteStr, x), transposeNoteBySemis(baseNoteStr, y)];
    for (let k = 0; k < TICKS_PER_STEP; k++) {
      const fq = Tone.Frequency(names[k % 3]).toFrequency();
      setMelodicFreq(k, fq, synth);
    }
  } else if (cmd === "L") {
    const f1 = baseFreq;
    const prev = lastPlayedNoteByChannel[channel];
    let f0 = f1;
    if (prev) {
      try { f0 = Tone.Frequency(transposeNoteBySemis(prev, transposeSemis)).toFrequency(); } catch { /* ignore */ }
    }
    for (let k = 0; k < TICKS_PER_STEP; k++) {
      const a = TICKS_PER_STEP <= 1 ? 1 : k / (TICKS_PER_STEP - 1);
      setMelodicFreq(k, f0 + (f1 - f0) * a, synth);
    }
  } else if (cmd === "P") {
    let f = baseFreq;
    for (let k = 0; k < TICKS_PER_STEP; k++) {
      setMelodicFreq(k, f, synth);
      const st = signedInt8FromByte(valByte) / 16;
      f *= Math.pow(2, st / 12);
    }
  } else if (cmd === "V") {
    const rateHz = 4 + (((valByte ?? 0) >> 4) & 0x0f) * 0.65;
    const depth = VIBRATO_DEPTH_SEMITONES[(valByte ?? 0) & 0x0f];
    for (let k = 0; k < TICKS_PER_STEP; k++) {
      const tSec = (k / TICKS_PER_STEP) * stepDurSec;
      const lfo = Math.sin(2 * Math.PI * rateHz * tSec);
      const fq = baseFreq * Math.pow(2, (depth * lfo) / 12);
      setMelodicFreq(k, fq, synth);
    }
  } else if (cmd === "S") {
    const h = ((valByte ?? 0) >> 4) & 0x0f;
    const mag = 1 + (h / 15) * 1.75;
    const down = ((valByte ?? 0) & 1) === 0;
    const fEnd = baseFreq;
    const fStart = down ? fEnd * mag : fEnd / mag;
    for (let k = 0; k < TICKS_PER_STEP; k++) {
      const a = TICKS_PER_STEP <= 1 ? 1 : k / (TICKS_PER_STEP - 1);
      setMelodicFreq(k, fStart + (fEnd - fStart) * a, synth);
    }
  } else {
    applyDefaultConstantPitch();
  }

  lastPlayedNoteByChannel[channel] = phraseNoteToString(baseNoteStr);
  heldNoteByChannel[channel] = lenSec === Infinity;
}

function getOutputLatencySeconds() {
  try {
    const raw = Tone.getContext()?.rawContext;
    if (raw && typeof raw.outputLatency === "number" && Number.isFinite(raw.outputLatency)) {
      return Math.max(0, raw.outputLatency);
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/** Browser `outputLatency` plus manual playhead offset (`state.visualOffsetMs`). */
function getTotalPlayheadDelaySeconds() {
  const outLat = getOutputLatencySeconds();
  const manual = (Number(state.visualOffsetMs) || 0) / 1000;
  const total = Math.max(0, outLat + manual);
  // (debug logging disabled by default)
  return total;
}

/**
 * Defer playhead UI until roughly when this step is heard (output latency + manual offset).
 * @param {number} audioContextEventTime
 * @param {number} scheduleGen
 * @param {"P"|"C"|"S"} mode
 * @param {() => void} fn
 */
function scheduleDeferredPlayheadUpdate(audioContextEventTime, scheduleGen, mode, fn) {
  const delay = getTotalPlayheadDelaySeconds();
  const when = audioContextEventTime + delay;
  const run = () => {
    if (!isPlaying || scheduleGen !== playheadScheduleGen || playMode !== mode) return;
    fn();
  };
  if (typeof Tone.Draw !== "undefined" && typeof Tone.Draw.schedule === "function") {
    Tone.Draw.schedule(run, when);
  } else {
    const raw = Tone.getContext()?.rawContext;
    const now = raw?.currentTime ?? 0;
    window.setTimeout(run, Math.max(0, (when - now) * 1000));
  }
}

function startPhrasePlayback() {
  if (!engineReady) return;
  if (isPlaying) return;

  isPlaying = true;
  audioDebugTriggerCount = 0;
  resetPerChannelTriggerSafeTimes();
  syncPlayButtonUI();
  playMode = "P";
  playSongRow = -1;
  playChainRow = -1;
  playRow = -1;
  applyPlayheadUI();

  playheadScheduleGen += 1;
  phrasePlayheadAnchorTime = null;
  const stepDur = Tone.Time("16n").toSeconds();
  let idx = 0;

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const tickAudioNow = Tone.getContext()?.rawContext?.currentTime ?? time;
    logTransportCallbackTiming("P", time, tickAudioNow);
    if (idx === 0) audioDebugLogCritical({ where: "transport.tick", mode: "P", time });
    // IMPORTANT: `time` from Tone.Transport is not necessarily the same clock as `rawContext.currentTime`.
    // Anchor the playhead in the *same* time domain as `updatePhrasePlayheadFromVisualTime` (visualTime),
    // using the same "safeTime" we schedule notes at.
    if (phrasePlayheadAnchorTime == null) {
      const totalDelay = getTotalPlayheadDelaySeconds();
      const safeTime0 = Math.max(time, tickAudioNow + 0.004);
      phrasePlayheadAnchorTime = safeTime0 - totalDelay;
      audioDebugLogCritical({
        where: "playhead.anchor",
        transportTime: time,
        tickAudioNow,
        safeTime0,
        totalDelay,
        anchorVisualTime: phrasePlayheadAnchorTime,
      });
    }
    const row = idx % ROWS;

    const step = currentPhrase().steps[row];
    triggerStep(step, time, stepDur, { tickAudioNow });

    idx++;
  }, "16n");

  Tone.Transport.start();
  startPhrasePlayheadRafLoop();
  setStatus("Playing. Enter to pause.");
}

function startChainPlayback() {
  if (!engineReady) return;
  if (isPlaying) return;

  isPlaying = true;
  resetPerChannelTriggerSafeTimes();
  syncPlayButtonUI();
  playMode = "C";
  playSongRow = -1;
  playRow = -1;
  applyPlayheadUI();

  const stepDur = Tone.Time("16n").toSeconds();
  let stepIdx = 0;
  let chainRow = 0;

  playChainRow = chainRow;
  renderChainView();

  playheadScheduleGen += 1;
  const scheduleGen = playheadScheduleGen;

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const tickAudioNow = Tone.getContext()?.rawContext?.currentTime ?? time;
    logTransportCallbackTiming("C", time, tickAudioNow);
    try {
      const chain = state.chains?.[activeChainId] ?? [];
      let entry = normalizeChainRow(chain[chainRow]);
      let phraseId = entry.phraseId;
      if (phraseId == null) {
        chainRow = 0;
        entry = normalizeChainRow(chain[chainRow]);
        phraseId = entry.phraseId;
        if (phraseId == null) {
          stepIdx = (stepIdx + 1) % ROWS;
          return;
        }
      }

      const phrase = state.phrases?.[phraseId];
      const step = phrase?.steps?.[stepIdx];
      if (step) triggerStep(step, time, stepDur, { tickAudioNow, transposeSemis: semisFromTspByte(entry.tsp) });

      if (stepIdx === ROWS - 1) {
        const nextRow = chainRow + 1;
        if (nextRow >= ROWS || chain[nextRow] == null) chainRow = 0;
        else chainRow = nextRow;
        stepIdx = 0;
      } else {
        stepIdx++;
      }
    } finally {
      const cr = chainRow;
      scheduleDeferredPlayheadUpdate(time, scheduleGen, "C", () => {
        playChainRow = cr;
        if (activeScreen === "C") renderChainView();
      });
    }
  }, "16n");

  Tone.Transport.start();
  setStatus(`Playing ${chainLabel(activeChainId)}. Enter to pause.`);
}

function startSongPlayback() {
  if (!engineReady) return;
  if (isPlaying) return;

  isPlaying = true;
  resetPerChannelTriggerSafeTimes();
  syncPlayButtonUI();
  playMode = "S";
  playRow = -1;
  playChainRow = -1;
  playSongRow = 0;
  applyPlayheadUI();
  if (activeScreen === "S") renderSongView(); // ensure Row 00 highlights immediately

  playheadScheduleGen += 1;
  const scheduleGen = playheadScheduleGen;
  const stepDur = Tone.Time("16n").toSeconds();
  let stepIdx = 0;
  let songRow = 0;
  let chainRow = 0;

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const tickAudioNow = Tone.getContext()?.rawContext?.currentTime ?? time;
    logTransportCallbackTiming("S", time, tickAudioNow);
    try {
      const songEntry = state.song?.[songRow];
      const chainIds = Array.isArray(songEntry) ? songEntry : SONG_COLS.map((_, c) => (c === 0 ? songEntry : null));

      const hasAny = chainIds?.some((v) => v != null);
      if (!hasAny) {
        songRow = 0;
        chainRow = 0;
        const firstEntry = state.song?.[songRow];
        const firstIds = Array.isArray(firstEntry) ? firstEntry : SONG_COLS.map((_, c) => (c === 0 ? firstEntry : null));
        if (!firstIds?.some((v) => v != null)) {
          stepIdx = (stepIdx + 1) % ROWS;
          return;
        }
      }

      // Parallel trigger across 4 Song columns with fixed instrument mapping.
      // PU1 -> channel 0, PU2 -> channel 1, WAV -> channel 2, NOI -> channel 3
      for (let t = 0; t < 4; t++) {
        const chainId = chainIds?.[t];
        if (chainId == null) continue;
        const chain = state.chains?.[chainId] ?? [];
        let entry = normalizeChainRow(chain[chainRow]);
        if (entry.phraseId == null) {
          entry = normalizeChainRow(chain[0]);
        }
        const phraseId = entry.phraseId;
        if (phraseId == null) continue;
        const phrase = state.phrases?.[phraseId];
        const step = phrase?.steps?.[stepIdx];
        if (step) {
          triggerStep(step, time, stepDur, {
            tickAudioNow,
            channelOverride: t,
            transposeSemis: semisFromTspByte(entry.tsp),
          });
        }
      }

      if (stepIdx === ROWS - 1) {
        const nextChainRow = chainRow + 1;
        // Global chainRow drives which phrase-slot is being used in each chain.
        // When the next chain row is empty for ALL active chains, advance the song row.
        let anyHasNext = false;
        for (let t = 0; t < 4; t++) {
          const chainId = chainIds?.[t];
          if (chainId == null) continue;
          const chain = state.chains?.[chainId] ?? [];
          if (nextChainRow < ROWS && normalizeChainRow(chain[nextChainRow]).phraseId != null) {
            anyHasNext = true;
            break;
          }
        }

        if (nextChainRow >= ROWS || !anyHasNext) {
          chainRow = 0;
          const nextSong = songRow + 1;
          const nextEntry = state.song?.[nextSong];
          const nextIds = Array.isArray(nextEntry) ? nextEntry : SONG_COLS.map((_, c) => (c === 0 ? nextEntry : null));
          if (nextSong >= ROWS || !nextIds?.some((v) => v != null)) songRow = 0;
          else songRow = nextSong;
        } else {
          chainRow = nextChainRow;
        }
        stepIdx = 0;
      } else {
        stepIdx++;
      }
    } finally {
      const sr = songRow;
      scheduleDeferredPlayheadUpdate(time, scheduleGen, "S", () => {
        playSongRow = sr;
        if (activeScreen === "S") renderSongView();
      });
    }
  }, "16n");

  Tone.Transport.start();
  setStatus("Playing Song. Enter to pause.");
}

function stopPlayback() {
  if (!engineReady) return;
  if (!isPlaying) return;
  audioDebugLogCritical({ where: "transport.stop" });

  isPlaying = false;
  playheadScheduleGen += 1;
  stopPhrasePlayheadRaf();
  syncPlayButtonUI();
  if (stepEventId != null) {
    Tone.Transport.clear(stepEventId);
    stepEventId = null;
  }
  Tone.Transport.stop();
  releaseAllHeldNotes();
  // Prevent “frozen” sustained notes (ENV2=1, LENGTH=1F) after pause/stop.
  const now = Tone.getContext()?.rawContext?.currentTime ?? 0;
  // Cancel scheduled envelopes FIRST, then ramp to silence (otherwise we cancel our own ramp).
  try { if (gatePulse1?.gain) gatePulse1.gain.cancelScheduledValues(now); } catch {}
  try { if (gatePulse2?.gain) gatePulse2.gain.cancelScheduledValues(now); } catch {}
  try { if (gateWave?.gain) gateWave.gain.cancelScheduledValues(now); } catch {}
  try { if (gateNoise?.gain) gateNoise.gain.cancelScheduledValues(now); } catch {}
  silenceAllGatesOnStop(now);
  flushPendingOscStealsAtStop();
  resetPerChannelTriggerSafeTimes();
  playRow = -1;
  playChainRow = -1;
  playSongRow = -1;
  applyPlayheadUI();
  renderChainView();
  renderSongView();
  setStatus("Stopped.");
}

function togglePlayback() {
  if (!engineReady) {
    setStatus("Press Master Start first (autoplay policy).");
    return;
  }
  audioDebugLogCritical({ where: "transport.toggle", isPlaying, screen: activeScreen });
  if (isPlaying) stopPlayback();
  else if (activeScreen === "S") startSongPlayback();
  else if (activeScreen === "C") startChainPlayback();
  else startPhrasePlayback();
}

function shouldPrioritizeWebShareForExport() {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

async function exportSongCode() {
  const json = JSON.stringify(state);
  const sharePayload = { title: "Tate Tracker Project", text: json };

  const tryShare = async () => {
    if (typeof navigator.share !== "function") return false;
    await navigator.share(sharePayload);
    return true;
  };

  const tryClipboard = async () => {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(json);
    return true;
  };

  const mobileFirst = shouldPrioritizeWebShareForExport();

  if (mobileFirst) {
    try {
      await tryShare();
      setStatus("Shared project JSON.");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") {
        setStatus("Export cancelled.");
        return;
      }
    }
    try {
      if (await tryClipboard()) {
        setStatus("COPIED");
        return;
      }
    } catch {
      /* fall through */
    }
  } else {
    try {
      if (await tryClipboard()) {
        setStatus("COPIED");
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      await tryShare();
      setStatus("Shared project JSON.");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") {
        setStatus("Export cancelled.");
        return;
      }
    }
  }
  setStatus("Could not copy to clipboard. Try Share from a supported browser, or Export on desktop.");
}

function sanitizeImportedProjectJson(code) {
  return String(code ?? "")
    .trim()
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

/** @returns {boolean} true if project was loaded */
function importSongCode(code) {
  const cleanCode = sanitizeImportedProjectJson(code);
  if (!cleanCode) return false;
  let parsed;
  try {
    parsed = JSON.parse(cleanCode);
  } catch {
    console.error("Failed JSON string:", cleanCode);
    setStatus("Import failed: JSON syntax error");
    return false;
  }
  state = coerceProjectState(parsed);
  afterProjectLoaded("Imported project JSON.");
  return true;
}

function showImportOverlay() {
  if (!elImportOverlay || !elImportOverlayText) return;
  elImportOverlayText.value = "";
  elImportOverlay.removeAttribute("hidden");
  elImportOverlay.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => {
    elImportOverlayText.focus({ preventScroll: true });
  });
}

function hideImportOverlay() {
  if (!elImportOverlay) return;
  elImportOverlay.setAttribute("hidden", "");
  elImportOverlay.setAttribute("aria-hidden", "true");
}

function coerceProjectState(parsed) {
  const s = defaultState();
  if (!parsed || typeof parsed !== "object") return s;

  if (Number.isFinite(parsed?.bpm)) s.bpm = clamp(parsed.bpm, BPM_RANGE_MIN, BPM_RANGE_MAX);
  if (Number.isFinite(parsed?.visualOffsetMs)) s.visualOffsetMs = clamp(parsed.visualOffsetMs | 0, 0, 500);
  if (Number.isFinite(parsed?.pulse1Width)) s.pulse1Width = parsed.pulse1Width;
  if (Number.isFinite(parsed?.pulse2Width)) s.pulse2Width = parsed.pulse2Width;
  if (typeof parsed?.wavType === "string") s.wavType = parsed.wavType;
  if (typeof parsed?.noiseType === "string") s.noiseType = parsed.noiseType;
  if (Array.isArray(parsed?.mixVol) && parsed.mixVol.length >= 4) {
    s.mixVol = [0, 1, 2, 3].map((i) => clamp(parseInt(parsed.mixVol[i], 10) || 0, 0, 100));
  }

  // Song: always 16 rows of 4 nullable bytes
  if (Array.isArray(parsed?.song) && parsed.song.length) {
    for (let r = 0; r < ROWS; r++) {
      const row = parsed.song[r];
      if (Array.isArray(row)) {
        s.song[r] = SONG_COLS.map((_, c) => byteOrNullFromLegacy(row[c]));
      } else {
        const b = byteOrNullFromLegacy(row);
        s.song[r] = SONG_COLS.map((_, c) => (c === 0 ? b : null));
      }
    }
  }

  // Chains: id -> 16 rows of { phraseId, tsp }
  if (parsed?.chains && typeof parsed.chains === "object") {
    for (const [k, arr] of Object.entries(parsed.chains)) {
      const id = parseInt(k, 10);
      if (!Number.isFinite(id)) continue;
      if (!Array.isArray(arr)) continue;
      s.chains[id] = Array.from({ length: ROWS }, (_, i) => {
        const src = arr[i];
        if (src != null && typeof src === "object") return normalizeChainRow(src);
        const phraseId = byteOrNullFromLegacy(src);
        return { phraseId, tsp: phraseId == null ? 0x00 : 0x00 };
      });
    }
  }

  // Phrases: id -> { steps[16] }
  if (parsed?.phrases && typeof parsed.phrases === "object") {
    for (const [k, p] of Object.entries(parsed.phrases)) {
      const id = parseInt(k, 10);
      if (!Number.isFinite(id)) continue;
      if (!p || typeof p !== "object") continue;
      const steps = Array.isArray(p.steps) ? p.steps : null;
      if (!steps) continue;
      s.phrases[id] = {
        steps: Array.from({ length: ROWS }, (_, i) => {
          const src = steps[i] ?? {};
          return {
            note: normalizeNote(src.note) || "",
            instr: normalizeInstr(byteOrNullFromLegacy(src.instr)),
            cmd: cmdByteFromLegacy(src.cmd),
            val: byteOrNullFromLegacy(src.val),
          };
        }),
      };
    }
  }

  // Legacy migration: a single `steps` pattern becomes Phrase 00, with Song -> Chain 00 -> Phrase 00.
  if (Array.isArray(parsed?.steps)) {
    const migrated = Array.from({ length: ROWS }, (_, i) => {
      const src = parsed.steps[i] ?? {};
      return {
        note: normalizeNote(src.note) || "",
        instr: normalizeInstr(byteOrNullFromLegacy(src.instr)),
        cmd: cmdByteFromLegacy(src.cmd),
        val: byteOrNullFromLegacy(src.val),
      };
    });
    s.phrases[0x00] = { steps: migrated };
    s.song = Array.from({ length: ROWS }, () => SONG_COLS.map((_, c) => (c === 0 ? 0x00 : null)));
    s.chains[0x00] = Array.from({ length: ROWS }, () => ({ phraseId: 0x00, tsp: 0x00 }));
  }

  // Ensure at least 00 exists
  if (!s.chains[0x00]) s.chains[0x00] = Array.from({ length: ROWS }, () => emptyChainRow());
  if (!s.phrases[0x00]) s.phrases[0x00] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };

  if (Array.isArray(parsed?.instruments)) {
    s.instruments = parsed.instruments;
  }
  ensureInstrumentsInState(s);
  return s;
}

function afterProjectLoaded(msg) {
  saveState();
  syncSettingsFormFromState();
  if (elPulse1Width) elPulse1Width.value = String(state.pulse1Width);
  if (elPulse2Width) elPulse2Width.value = String(state.pulse2Width);
  if (elWavType) elWavType.value = String(state.wavType || "triangle");
  if (elNoiseType) elNoiseType.value = String(state.noiseType || "white");
  if (elMixVol0) elMixVol0.value = String(clamp(state.mixVol?.[0] ?? 90, 0, 100));
  if (elMixVol1) elMixVol1.value = String(clamp(state.mixVol?.[1] ?? 90, 0, 100));
  if (elMixVol2) elMixVol2.value = String(clamp(state.mixVol?.[2] ?? 90, 0, 100));
  if (elMixVol3) elMixVol3.value = String(clamp(state.mixVol?.[3] ?? 90, 0, 100));
  if (elMixVol0Val) elMixVol0Val.textContent = elMixVol0?.value ?? "";
  if (elMixVol1Val) elMixVol1Val.textContent = elMixVol1?.value ?? "";
  if (elMixVol2Val) elMixVol2Val.textContent = elMixVol2?.value ?? "";
  if (elMixVol3Val) elMixVol3Val.textContent = elMixVol3?.value ?? "";

  if (engineReady) {
    Tone.Transport.bpm.value = state.bpm;
    applyPulseWidth(1, state.pulse1Width);
    applyPulseWidth(2, state.pulse2Width);
    applyInstrumentSettingsFromState();
  }

  // Re-anchor active ids to a valid slot
  const sr = state.song?.[songSelRow];
  activeChainId = (Array.isArray(sr) ? sr[songSelCol] : (songSelCol === 0 ? sr : null)) ?? 0x00;
  if (!state.chains[activeChainId]) state.chains[activeChainId] = Array.from({ length: ROWS }, () => emptyChainRow());
  state.chains[activeChainId] = state.chains[activeChainId].map((r) => normalizeChainRow(r));
  activePhraseId = normalizeChainRow(state.chains[activeChainId][chainSelRow]).phraseId ?? 0x00;
  if (!state.phrases[activePhraseId]) {
    state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };
  }

  setActiveScreen(activeScreen, { force: true });
  // Force all views to reflect new global state immediately.
  renderTracker({ force: true });
  renderSongView({ force: true });
  renderChainView({ force: true });
  renderInstrumentView();
  setStatus(msg);
  setStatusCursor();
}

function resetProject() {
  if (!window.confirm("Clear everything?")) return;
  stopPlayback();

  state = defaultState();

  // Reset all selection + navigation state so the UI anchors cleanly.
  selRow = 0;
  selCol = 1;
  songSelRow = 0;
  songSelCol = 0;
  chainSelRow = 0;
  chainSelCol = 0;
  activeChainId = 0x00;
  activePhraseId = 0x00;
  activeScreen = "S";
  instrumentTargetIndex = 0;
  instSelRow = 0;
  instSelCol = 1;
  playRow = -1;
  playChainRow = -1;
  playSongRow = -1;
  playMode = "P";
  isZPressed = false;
  isXPressed = false;
  keyState.a = false;
  keyState.select = false;

  afterProjectLoaded("Reset project to default state.");
}

function initUI() {
  syncSettingsFormFromState();
  if (elPulse1Width) elPulse1Width.value = String(state.pulse1Width);
  if (elPulse2Width) elPulse2Width.value = String(state.pulse2Width);
  if (elWavType) elWavType.value = String(state.wavType || "triangle");
  if (elNoiseType) elNoiseType.value = String(state.noiseType || "white");
  const vols = Array.isArray(state.mixVol) ? state.mixVol : [90, 90, 90, 90];
  if (elMixVol0) elMixVol0.value = String(clamp(vols[0] ?? 90, 0, 100));
  if (elMixVol1) elMixVol1.value = String(clamp(vols[1] ?? 90, 0, 100));
  if (elMixVol2) elMixVol2.value = String(clamp(vols[2] ?? 90, 0, 100));
  if (elMixVol3) elMixVol3.value = String(clamp(vols[3] ?? 90, 0, 100));
  if (elMixVol0Val) elMixVol0Val.textContent = elMixVol0?.value ?? "";
  if (elMixVol1Val) elMixVol1Val.textContent = elMixVol1?.value ?? "";
  if (elMixVol2Val) elMixVol2Val.textContent = elMixVol2?.value ?? "";
  if (elMixVol3Val) elMixVol3Val.textContent = elMixVol3?.value ?? "";
  if (elPlaceholderTitle) elPlaceholderTitle.textContent = SCREEN_NAMES[activeScreen] ?? "--";
  renderNavMap();

  elNavMap?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest(".navmap__btn");
    if (!btn) return;
    const scr = btn.getAttribute("data-screen");
    if (scr) handleNavClick(scr);
  });
  // Explicit binding as backup (some mobile browsers can be finicky with delegation).
  elNavMap?.querySelectorAll(".navmap__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scr = btn.getAttribute("data-screen");
      if (scr) handleNavClick(scr);
    });
    btn.addEventListener("touchend", (e) => {
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      e.preventDefault();
      const scr = btn.getAttribute("data-screen");
      if (scr) handleNavClick(scr);
    }, { passive: false });
  });

  elMasterStart.addEventListener("click", () => {
    masterStart().catch((err) => {
      const msg = String(err?.message || err || "Unknown error");
      setStatus(`Failed to start audio context. ${msg}`);
      audioDebugLog({ where: "masterStartFail", msg });
    });
  });
  // Mobile: use touchend + preventDefault to avoid ghost double-tap/click.
  elPlay.addEventListener("touchend", (e) => {
    e.preventDefault();
    togglePlayback();
  }, { passive: false });
  // Desktop fallback
  elPlay.addEventListener("click", () => togglePlayback());
  syncPlayButtonUI();
  syncMasterStartButtonUI();

  elBpmSettingsBtn?.addEventListener("click", () => {
    showSettingsOverlay();
  });
  elSettingsBpmSlider?.addEventListener("input", () => applyBpmFromSlider());
  elSettingsLatSlider?.addEventListener("input", () => applyVisualOffsetFromSlider());
  elSettingsOverlayDone?.addEventListener("click", () => hideSettingsOverlay());
  elPulse1Width?.addEventListener("change", () => {
    state.pulse1Width = Number(elPulse1Width.value);
    saveState();
    applyPulseWidth(1, state.pulse1Width);
    setStatus(`Pulse 1 Width = ${state.pulse1Width}%.`);
  });
  elPulse2Width?.addEventListener("change", () => {
    state.pulse2Width = Number(elPulse2Width.value);
    saveState();
    applyPulseWidth(2, state.pulse2Width);
    setStatus(`Pulse 2 Width = ${state.pulse2Width}%.`);
  });

  elWavType?.addEventListener("change", () => {
    state.wavType = String(elWavType.value || "triangle");
    saveState();
    if (engineReady) applyInstrumentSettingsFromState();
    setStatus(`WAV = ${state.wavType}.`);
  });

  elNoiseType?.addEventListener("change", () => {
    state.noiseType = String(elNoiseType.value || "white");
    saveState();
    if (engineReady) applyInstrumentSettingsFromState();
    setStatus(`NOI = ${state.noiseType}.`);
  });

  function bindMixer(which, el, elVal) {
    if (!el) return;
    const apply = () => {
      const v = clamp(parseInt(el.value, 10) || 0, 0, 100);
      if (!Array.isArray(state.mixVol)) state.mixVol = [90, 90, 90, 90];
      state.mixVol[which] = v;
      if (elVal) elVal.textContent = String(v);
      saveState();
      if (engineReady) applyInstrumentSettingsFromState();
    };
    el.addEventListener("input", apply);
    el.addEventListener("change", apply);
  }
  bindMixer(0, elMixVol0, elMixVol0Val);
  bindMixer(1, elMixVol1, elMixVol1Val);
  bindMixer(2, elMixVol2, elMixVol2Val);
  bindMixer(3, elMixVol3, elMixVol3Val);

  elExport.addEventListener("click", () => {
    exportSongCode().catch(() => setStatus("Export failed."));
  });
  elImportBtn?.addEventListener("click", () => {
    showImportOverlay();
  });
  elImportOverlayCancel?.addEventListener("click", () => {
    hideImportOverlay();
  });
  elImportOverlayLoad?.addEventListener("click", () => {
    const raw = elImportOverlayText?.value ?? "";
    if (importSongCode(raw)) hideImportOverlay();
  });
  elReset?.addEventListener("click", () => resetProject());

  elCellMenuSelect?.addEventListener("change", () => {
    const action = elCellMenuSelect.value;
    // Reset immediately for next use.
    elCellMenuSelect.selectedIndex = 0;
    resetGhostSelect();

    const current = readCurrentCellValue();
    const hasRange = state.selectedRange && state.selectedRange.screen === activeScreen;

    if (action === "copy") {
      if (hasRange) {
        cellClipboard = buildRangeClipboard(state.selectedRange);
        setStatus("Copied range.");
      } else {
        if (!current?.type) return;
        cellClipboard = current;
        setStatus(`Copied ${cellClipboard?.type ?? "--"}.`);
      }
      return;
    }
    if (action === "paste") {
      if (cellClipboard?.kind === "range") {
        pasteRangeAtCursor(cellClipboard);
        return;
      }
      if (!current?.type) return;
      if (cellClipboard?.type && cellClipboard.type === current.type) {
        writeCurrentCellValue(cellClipboard);
      } else {
        setStatus("Paste blocked (type mismatch).");
      }
      return;
    }
    if (action === "delete") {
      if (hasRange) clearCellsInRange(state.selectedRange);
      else clearCurrentCell();
    }
  });

  // Opening the native picker from a fully invisible <select> is inconsistent on mobile; nudge it open on direct taps.
  elCellMenuSelect?.addEventListener(
    "pointerdown",
    (e) => {
      if (isOpeningCellMenuSelect) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      isOpeningCellMenuSelect = true;
      try {
        elCellMenuSelect.selectedIndex = 0;
        elCellMenuSelect.focus({ preventScroll: true });
        if (typeof elCellMenuSelect.showPicker === "function") {
          try {
            elCellMenuSelect.showPicker();
            return;
          } catch {
            /* fall through */
          }
        }
        elCellMenuSelect.click();
      } finally {
        window.setTimeout(() => {
          isOpeningCellMenuSelect = false;
        }, 0);
      }
    },
    { passive: false },
  );

  function isGhostableEditCellEl(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.classList.contains("cell") && el.classList.contains("editcell")) return true;
    if (el.classList.contains("list16__cell") && el.classList.contains("editcell")) return true;
    return false;
  }

  // Click-away: taps outside grid/list edit cells park the ghost select off-screen.
  window.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (elNudgeBar && elNudgeBar.contains(t)) return;
    if (elCellMenuSelect && elCellMenuSelect.contains(t)) return;
    const el = t instanceof HTMLElement ? t : null;
    if (el && isGhostableEditCellEl(el)) return;
    if (el && typeof el.closest === "function") {
      const hit = el.closest(".cell.editcell, .list16__cell.editcell");
      if (hit) return;
    }
    clearTransientGridSelection();
    resetGhostSelect();
  }, { capture: true });

  // Phrase cell: first tap selects and parks ghost <select> over the cell; second tap hits the select.
  elTracker.addEventListener("pointerdown", (e) => {
    if (activeScreen !== "P") return;
    if (e.pointerType === "touch" && e.isPrimary === false) {
      e.preventDefault();
      return;
    }
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.classList.contains("cell") ? target : target.closest(".cell");
    if (!cell) return;
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    if (c === 0) return; // Row index column
    e.preventDefault();

    state.selectedRange = null;
    selRow = clamp(r, 0, ROWS - 1);
    selCol = clamp(c, 0, COLS.length - 1);
    state.selectionAnchor = { screen: "P", row: selRow, col: selCol };
    renderTracker({ force: true });
    focusMain();
  });

  elTracker?.addEventListener("touchstart", handleGridTouchStart, { passive: false });
  elSongView?.addEventListener("touchstart", handleGridTouchStart, { passive: false });
  elChainView?.addEventListener("touchstart", handleGridTouchStart, { passive: false });
  elInstrumentGrid?.addEventListener("touchstart", handleGridTouchStart, { passive: false });
  elTracker?.addEventListener("touchmove", handleGridTouchMove, { passive: false });
  elSongView?.addEventListener("touchmove", handleGridTouchMove, { passive: false });
  elChainView?.addEventListener("touchmove", handleGridTouchMove, { passive: false });
  elInstrumentGrid?.addEventListener("touchmove", handleGridTouchMove, { passive: false });

  function pointerDownSelectList(e, expectedScreen) {
    if (activeScreen !== expectedScreen) return;
    if (e.pointerType === "touch" && e.isPrimary === false) {
      e.preventDefault();
      return;
    }
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const listCell = target.classList.contains("list16__cell") ? target : target.closest(".list16__cell");
    if (!listCell) return;
    const screen = listCell.dataset.screen;
    if (screen !== expectedScreen) return;
    const r = Number(listCell.dataset.row);
    const c = Number(listCell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    e.preventDefault();

    state.selectedRange = null;

    if (expectedScreen === "S") {
      songSelRow = clamp(r, 0, ROWS - 1);
      songSelCol = clamp(c, 0, SONG_COLS.length - 1);
      state.selectionAnchor = { screen: "S", row: songSelRow, col: songSelCol };
      renderSongView({ force: true });
      setStatusCursor();
      return;
    }

    chainSelRow = clamp(r, 0, ROWS - 1);
    chainSelCol = clamp(c, 0, 1);
    state.selectionAnchor = { screen: "C", row: chainSelRow, col: chainSelCol };
    renderChainView({ force: true });
    setStatusCursor();
  }

  elSongView?.addEventListener("pointerdown", (e) => pointerDownSelectList(e, "S"));
  elChainView?.addEventListener("pointerdown", (e) => pointerDownSelectList(e, "C"));

  function pointerDownSelectInstrument(e) {
    if (activeScreen !== "I") return;
    if (e.pointerType === "touch" && e.isPrimary === false) {
      e.preventDefault();
      return;
    }
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const listCell = target.classList.contains("list16__cell") ? target : target.closest(".list16__cell");
    if (!listCell || !listCell.classList.contains("editcell")) return;
    if (listCell.dataset.screen !== "I") return;
    const r = Number(listCell.dataset.row);
    const c = Number(listCell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    e.preventDefault();
    state.selectedRange = null;
    instSelRow = clamp(r, 0, INSTRUMENT_PARAM_ROWS - 1);
    instSelCol = clamp(c, 1, 1);
    state.selectionAnchor = { screen: "I", row: instSelRow, col: instSelCol };
    renderInstrumentView();
    setStatusCursor();
    setStatus(instrumentStatusForRow(instSelRow));
    focusMain();
  }
  elInstrumentGrid?.addEventListener("pointerdown", pointerDownSelectInstrument);

  function handleNudgeBarPointerDown(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest(".nudge-bar__btn");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const action = btn.getAttribute("data-nudge");
    if (!action) return;

    const isRandom = action === "random";
    nudgeSelectedCell({ action, isRandom });
  }

  elNudgeBar?.addEventListener("pointerdown", handleNudgeBarPointerDown, { passive: false });

  function onSongChainDrillDblClick(e) {
    if (activeScreen !== "S" && activeScreen !== "C") return;
    if (rangeSelectionBlocksDrill()) {
      e.preventDefault();
      setStatus("Clear selection to drill down.");
      return;
    }
    drillDown();
  }
  elSongView?.addEventListener("dblclick", onSongChainDrillDblClick);
  elChainView?.addEventListener("dblclick", onSongChainDrillDblClick);

  function handleKeyDown(e) {
    if (elSettingsOverlay && !elSettingsOverlay.hasAttribute("hidden")) {
      const ae = document.activeElement;
      if (ae && elSettingsOverlay.contains(ae)) {
        if (e.key === "Escape") {
          e.preventDefault();
          hideSettingsOverlay();
        }
        return;
      }
    }
    if (elImportOverlay && !elImportOverlay.hasAttribute("hidden")) {
      const ae = document.activeElement;
      if (ae && elImportOverlay.contains(ae)) {
        if (e.key === "Escape") {
          e.preventDefault();
          hideImportOverlay();
        }
        return;
      }
    }

    if (e.key === "Enter") {
      if (activeScreen === "S" || activeScreen === "C") {
        e.preventDefault();
        if (rangeSelectionBlocksDrill()) {
          setStatus("Clear selection to drill down.");
          return;
        }
        drillDown();
        return;
      }
    }

    if (e.code === "ShiftRight") {
      keyState.select = true;
      return;
    }

    if (e.key.toLowerCase() === "z") {
      keyState.a = true;
      isZPressed = true;
      e.preventDefault();
      return;
    }

    // Start button
    if (e.key === " ") {
      e.preventDefault();
      togglePlayback();
      return;
    }

    // Button B (delete/back) + hardware reset combo (Z+X)
    if (e.key.toLowerCase() === "x") {
      e.preventDefault();
      isXPressed = true;
      if (isZPressed) {
        clearCurrentCell();
        return;
      }
      clearCell();
      return;
    }

    // D-pad
    const isArrow = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (!isArrow) return;
    e.preventDefault();

    if (keyState.select) {
      if (e.key === "ArrowRight") { if (activeScreen === "S") { drillDown(); return; } if (drillDown()) return; }
      if (e.key === "ArrowLeft") { if (drillUp()) return; }
      // Optional: keep the old screen map switching on up/down
      if (e.key === "ArrowUp") { tryMoveScreen(0, -1); return; }
      if (e.key === "ArrowDown") { tryMoveScreen(0, 1); return; }
    }

    if (isZPressed) {
      const delta =
        e.key === "ArrowUp" ? 1 :
        e.key === "ArrowDown" ? -1 :
        e.key === "ArrowRight" ? 16 :
        -16;

      if (activeScreen === "S") { applySongHexDelta(delta); return; }
      if (activeScreen === "C") { applyChainHexDelta(delta); return; }

      const handled = handleArrowWithA(e.key);
      if (handled) return;
      // If we're on the Row column (or unknown), fall back to navigation.
    }

    if (activeScreen === "S") {
      if (e.key === "ArrowUp") { moveSongSelection(-1); return; }
      if (e.key === "ArrowDown") { moveSongSelection(1); return; }
      if (e.key === "ArrowLeft") { moveSongSelectionCol(-1); return; }
      if (e.key === "ArrowRight") { moveSongSelectionCol(1); return; }
      return;
    }
    if (activeScreen === "I") {
      if (isZPressed) {
        const action =
          e.key === "ArrowUp" ? "inc" :
          e.key === "ArrowDown" ? "dec" :
          e.key === "ArrowRight" ? "jump_inc" :
          e.key === "ArrowLeft" ? "jump_dec" : null;
        if (action) {
          applyNudgeToInstrumentParam(instSelRow, action, false);
          saveState();
          renderInstrumentView();
          setStatus(instrumentStatusForRow(instSelRow));
        }
        return;
      }
      if (e.key === "ArrowUp") { moveInstrumentSelection(-1, 0); return; }
      if (e.key === "ArrowDown") { moveInstrumentSelection(1, 0); return; }
      if (e.key === "ArrowLeft") { moveInstrumentSelection(0, -1); return; }
      if (e.key === "ArrowRight") { moveInstrumentSelection(0, 1); return; }
      return;
    }
    if (activeScreen === "C") {
      if (e.key === "ArrowUp") { moveChainSelection(-1); return; }
      if (e.key === "ArrowDown") { moveChainSelection(1); return; }
      if (e.key === "ArrowLeft") { moveChainSelectionCol(-1); return; }
      if (e.key === "ArrowRight") { moveChainSelectionCol(1); return; }
      return;
    }

    if (e.key === "ArrowUp") { moveSelection(-1, 0); return; }
    if (e.key === "ArrowDown") { moveSelection(1, 0); return; }
    if (e.key === "ArrowLeft") { moveSelection(0, -1); return; }
    if (e.key === "ArrowRight") { moveSelection(0, 1); return; }
  }

  function handleKeyUp(e) {
    if (e.code === "ShiftRight") {
      keyState.select = false;
      return;
    }
    if (e.key.toLowerCase() === "z") {
      keyState.a = false;
      isZPressed = false;
      return;
    }
    if (e.key.toLowerCase() === "x") {
      isXPressed = false;
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  let ghostSyncRaf = 0;
  const scheduleGhostSync = () => {
    if (ghostSyncRaf) return;
    ghostSyncRaf = window.requestAnimationFrame(() => {
      ghostSyncRaf = 0;
      syncGhostSelectToSelection();
    });
  };
  window.addEventListener("resize", scheduleGhostSync, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleGhostSync, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleGhostSync, { passive: true });
}

initUI();
setActiveScreen(activeScreen, { force: true });
syncGhostSelectToSelection();
setStatusCursor();
focusMain();
