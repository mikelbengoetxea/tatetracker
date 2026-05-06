/* global Tone */

const STORAGE_KEY = "tate-tracker:v1";

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
  "OUTPUT",
  "LENGTH",
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
    mode: 0,
    env1: 0x80,
    env2: 0x00,
    env3: 0x40,
    output: 0,
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
  o.env1 = clampByte(o.env1 ?? base.env1);
  o.env2 = clampByte(o.env2 ?? base.env2);
  o.env3 = clampByte(o.env3 ?? base.env3);
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
const CMD_SET = new Set(["V", "P", "O", "D", "A", "W", "T"]);
const CMD_ORDER = [null, "V", "P", "O", "D", "A", "W", "T"];

function normalizeCmd(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim().toUpperCase();
    if (t === "" || t === "--" || t === ".") return null;
    return CMD_SET.has(t) ? t : null;
  }
  // Legacy numeric codes (kept for backward compatibility)
  if (typeof value === "number" && Number.isFinite(value)) {
    const v = clamp(value | 0, 0, 255);
    if (v === 0x01) return "V";
    if (v === 0x02) return "P";
    if (v === 0x03) return "D";
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
let synthPulse1 = null;
let synthPulse2 = null;
let synthWave = null;
let synthNoise = null;
let panPulse1 = null;
let panPulse2 = null;
let panWave = null;
let panNoise = null;
let gainPulse1 = null;
let gainPulse2 = null;
let gainWave = null;
let gainNoise = null;
let master = null;
let stepEventId = null;

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
let activeScreen = "P";
let activeChainId = 0x00;
let activePhraseId = 0x00;

let songSelRow = 0;
let songSelCol = 0; // 0..3 => PU1..NOI
let chainSelRow = 0;
let chainSelCol = 0; // 0..1 => PHR/TSP

let instrumentTargetIndex = 0;
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
  const s = clamp((Number(semis) || 0) | 0, -12, 12);
  return s < 0 ? 0x100 + s : s;
}

function semisFromTspByte(b) {
  return clamp(signedInt8FromByte(b), -12, 12);
}

function formatTsp(b) {
  const s = semisFromTspByte(b);
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
      if (COLS[c].key === "note") cell.classList.add("cell--note");
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
}

function setActiveScreen(next) {
  if (!next || !SCREEN_NAMES[next] || next === activeScreen) return;
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
  for (const btn of elNavMap.querySelectorAll(".navmap__btn")) {
    const scr = btn.getAttribute("data-screen");
    btn.classList.toggle("navmap__btn--active", scr != null && scr === activeScreen);
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
      if (cid != null) {
        activeChainId = cid;
        if (!state.chains[activeChainId]) state.chains[activeChainId] = Array.from({ length: ROWS }, () => emptyChainRow());
        setActiveScreen("C");
        return;
      }
    }
    setActiveScreen("C");
    return;
  }
  if (targetScreen === "P") {
    if (activeScreen === "C") {
      if (state.selectedRange?.screen === "C") {
        setStatus("Clear selection to open Phrase.");
        return;
      }
      const pid = getSelectedPhraseIdFromChain();
      if (pid != null) {
        activePhraseId = pid;
        if (!state.phrases[activePhraseId]) {
          state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: null, cmd: null, val: null })) };
        }
        setActiveScreen("P");
        return;
      }
    }
    setActiveScreen("P");
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
  const idx = CMD_ORDER.indexOf(prev);
  const at = idx >= 0 ? idx : 0;
  const next = CMD_ORDER[(at + deltaSign + CMD_ORDER.length) % CMD_ORDER.length];
  step.cmd = next;
  ensureValSemantics(step);
  if (engineReady && prev === "O" && next !== "O") immediateCenterPanForStep(step);
}

function nudgeBarSign(action) {
  if (action === "inc" || action === "jump_inc") return 1;
  if (action === "dec" || action === "jump_dec") return -1;
  return 0;
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
  if (pr === 6) return ins.output;
  if (pr === 7) return ins.length;
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
  if (pr === 3) return `Initial Volume: ${toHex2(clampByte(ins.env1))}`;
  if (pr === 4) return `Env Direction: ${(ins.env2 & 0x80) !== 0 ? "Down" : "Up"}`;
  if (pr === 5) return `Env Speed/Length: ${toHex2(clampByte(ins.env3))}`;
  if (pr === 6) return `Output: ${OUTPUT_LABELS[clamp(ins.output, 0, 2)]}`;
  if (pr === 7) {
    const L = clamp(ins.length | 0, 0, 31);
    return L === 0x1f ? "Note Length: Unlimited" : `Note Length: ${toHex2(L)}`;
  }
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
  else if (pr === 3) ins.env1 = clampByte(v);
  else if (pr === 4) ins.env2 = clampByte(v);
  else if (pr === 5) ins.env3 = clampByte(v);
  else if (pr === 6) ins.output = clamp(v, 0, 2);
  else if (pr === 7) ins.length = clamp(v, 0, 31);
  else ins.tablePreset = clamp(v, 0, 11);
  ins.name = instrumentDefaultName(instrumentTargetIndex);
}

function applyNudgeToInstrumentParam(paramRow, action, isRandom) {
  const pr = clamp(paramRow | 0, 0, INSTRUMENT_PARAM_ROWS - 1);
  const sign = nudgeBarSign(action);
  const isJump = action.startsWith("jump");
  const step = isJump ? 16 : 1;
  const cur = readInstrumentParamValue(pr);
  if (pr === 0) {
    if (isRandom) instrumentTargetIndex = randomInt(0, NUM_INSTRUMENTS - 1);
    else instrumentTargetIndex = clamp((cur || 0) + sign * step, 0, NUM_INSTRUMENTS - 1);
    return;
  }
  ensureInstrumentsInState(state);
  const ins = state.instruments[instrumentTargetIndex];
  if (pr === 1) {
    if (isRandom) ins.type = randomInt(0, 2);
    else ins.type = clamp(ins.type + sign * (isJump ? 2 : 1), 0, 2);
  } else if (pr === 2) {
    if (isRandom) ins.mode = randomInt(0, 3);
    else ins.mode = clamp(ins.mode + sign * (isJump ? 2 : 1), 0, 3);
  } else if (pr === 6) {
    if (isRandom) ins.output = randomInt(0, 2);
    else ins.output = clamp(ins.output + sign * (isJump ? 2 : 1), 0, 2);
  } else if (pr === 7) {
    if (isRandom) ins.length = randomInt(0, 31);
    else ins.length = clamp(ins.length + sign * (isJump ? 8 : 1), 0, 31);
  } else if (pr === 8) {
    if (isRandom) ins.tablePreset = randomInt(0, 11);
    else ins.tablePreset = clamp(ins.tablePreset + sign * (isJump ? 4 : 1), 0, 11);
  } else {
    const b = clampByte(cur);
    if (isRandom) {
      if (pr === 3) ins.env1 = randomInt(0, 255);
      else if (pr === 4) ins.env2 = randomInt(0, 255);
      else ins.env3 = randomInt(0, 255);
    } else if (pr === 3) ins.env1 = clampByte(b + sign * step);
    else if (pr === 4) ins.env2 = clampByte(b + sign * step);
    else ins.env3 = clampByte(b + sign * step);
  }
  ins.name = instrumentDefaultName(instrumentTargetIndex);
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
    const cur = Array.isArray(songRow) ? songRow[cc] : (cc === 0 ? songRow : null);
    const start = cur == null ? 0x00 : clampByte(cur);
    const sign = nudgeBarSign(action);
    const step = !isRandom && action.startsWith("jump") ? 16 : 1;
    const next = isRandom ? randomInt(0, 255) : clampByte(start + sign * step);
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
    const delta = isRandom ? 0 : sign * step;

    if (cc === 0) {
      const start = entry.phraseId == null ? 0x00 : clampByte(entry.phraseId);
      const next = isRandom ? randomInt(0, 255) : clampByte(start + delta);
      entry.phraseId = next;
      state.chains[activeChainId][rr] = entry;
      return;
    }

    const startSemis = semisFromTspByte(entry.tsp);
    const nextSemis = isRandom ? randomInt(-12, 12) : clamp(startSemis + delta, -12, 12);
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
      const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
      const startN = noteNumberFromParts(parsed);
      const nextN = isRandom
        ? noteNumberFromParts({ idx: randomInt(0, 11), octave: parsed.octave })
        : startN + sign * (isJump ? 12 : 1);
      step.note = makeNote(partsFromNoteNumber(nextN));
      return;
    }

    if (colKey === "instr") {
      const start = step.instr == null ? 0 : clamp(step.instr | 0, 0, 31);
      const next = isRandom ? randomInt(0, 31) : clamp(start + sign * (isJump ? 16 : 1), 0, 31);
      step.instr = next;
      return;
    }

    if (colKey === "cmd") {
      if (isRandom) {
        step.cmd = CMD_ORDER[randomInt(0, CMD_ORDER.length - 1)];
        ensureValSemantics(step);
        return;
      }
      applyCmdDeltaToStep(step, sign > 0 ? 1 : -1);
      return;
    }

    if (colKey === "val") {
      const start = step.val == null ? 0x00 : clampByte(step.val);
      const next = isRandom ? randomInt(0, 255) : clampByte(start + sign * (isJump ? 16 : 1));
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
    renderInstrumentView();
    setStatusCursor();
    setStatus(instrumentStatusForRow(instSelRow));
    return true;
  }

  if (activeScreen === "S") {
    applyNudgeToCell("S", songSelRow, songSelCol, action, isRandom);
    saveState();
    renderSongView({ force: true });
    setStatusCursor();
    setStatus("Nudged.");
    return true;
  }

  if (activeScreen === "C") {
    applyNudgeToCell("C", chainSelRow, chainSelCol, action, isRandom);
    saveState();
    renderChainView({ force: true });
    setStatusCursor();
    setStatus("Nudged.");
    return true;
  }

  applyNudgeToCell("P", selRow, selCol, action, isRandom);
  saveState();
  renderTracker({ force: true });
  setStatusCursor();
  setStatus("Nudged.");
  return true;
}

function applySongHexDelta(delta) {
  if (activeScreen !== "S") return;
  const row = state.song?.[songSelRow];
  const cur = Array.isArray(row) ? row[songSelCol] : (songSelCol === 0 ? row : null);
  if (cur == null) {
    if (Array.isArray(row)) row[songSelCol] = 0x00;
    else if (songSelCol === 0) state.song[songSelRow] = 0x00;
    saveState();
    renderSongView();
    setStatusCursor();
    setStatus(`Song ${SONG_COLS[songSelCol]?.key ?? "--"} @ ${rowHex(songSelRow)} = ${chainLabel(0x00)}`);
    return;
  }
  const next = clampByte((cur ?? 0) + delta);
  if (Array.isArray(row)) row[songSelCol] = next;
  else if (songSelCol === 0) state.song[songSelRow] = next;
  saveState();
  renderSongView();
  setStatusCursor();
  setStatus(`Song ${SONG_COLS[songSelCol]?.key ?? "--"} @ ${rowHex(songSelRow)} = ${chainLabel(next)}`);
}

function applyChainHexDelta(delta) {
  if (activeScreen !== "C") return;
  const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
  state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
  const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
  if (chainSelCol === 0) {
    if (entry.phraseId == null) {
      entry.phraseId = 0x00;
      if (entry.tsp == null) entry.tsp = 0x00;
      state.chains[activeChainId][chainSelRow] = entry;
      saveState();
      renderChainView();
      setStatusCursor();
      setStatus(`Chain ${idHex(activeChainId)} PHR @ ${rowHex(chainSelRow)} = ${phraseLabel(0x00)}`);
      return;
    }
    const next = clampByte((entry.phraseId ?? 0) + delta);
    entry.phraseId = next;
    state.chains[activeChainId][chainSelRow] = entry;
    saveState();
    renderChainView();
    setStatusCursor();
    setStatus(`Chain ${idHex(activeChainId)} PHR @ ${rowHex(chainSelRow)} = ${phraseLabel(next)}`);
    return;
  }
  const curSemis = semisFromTspByte(entry.tsp);
  const nextSemis = clamp(curSemis + delta, -12, 12);
  entry.tsp = tspByteFromSemis(nextSemis);
  state.chains[activeChainId][chainSelRow] = entry;
  saveState();
  renderChainView();
  setStatusCursor();
  setStatus(`Chain ${idHex(activeChainId)} TSP @ ${rowHex(chainSelRow)} = ${formatTsp(entry.tsp)}`);
}

function applyByteDelta(field, delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  if (field === "instr") {
    const cur = step.instr == null ? 0 : clamp(step.instr | 0, 0, 31);
    const next = clamp(cur + delta, 0, 31);
    step.instr = next;
    saveState();
    renderTracker();
    setStatus(`${COLS[selCol].label} @ ${rowHex(selRow)} = ${displayInstr(next)}`);
    return;
  }
  const current = step[field];
  const next = clampByte((current == null ? 0 : current) + delta);
  step[field] = next;
  if (field === "val") ensureValSemantics(step);
  saveState();
  renderTracker();
  setStatus(`${COLS[selCol].label} @ ${rowHex(selRow)} = ${displayByte(next, { kind: field === "cmd" ? "cmd" : "hex" })}`);
}

function applyCmdDelta(delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const prev = normalizeCmd(step.cmd);
  const idx = CMD_ORDER.indexOf(prev);
  const at = idx >= 0 ? idx : 0;
  const next = CMD_ORDER[(at + delta + CMD_ORDER.length) % CMD_ORDER.length];
  step.cmd = next;
  ensureValSemantics(step);
  saveState();
  renderTracker();
  // If leaving 'O', reset channel pan to center immediately (engine/UI consistency).
  if (engineReady && prev === "O" && next !== "O") {
    const channel = instrToChannel(step.instr);
    const panner =
      channel === 0 ? panPulse1 :
      channel === 1 ? panPulse2 :
      channel === 2 ? panWave :
      panNoise;
    if (panner?.pan?.value != null) panner.pan.value = 0;
  }
  setStatus(`Cmd @ ${rowHex(selRow)} = ${next ?? "--"}`);
}

function immediateCenterPanForStep(step) {
  if (!engineReady) return;
  const channel = instrToChannel(step?.instr);
  const panner =
    channel === 0 ? panPulse1 :
    channel === 1 ? panPulse2 :
    channel === 2 ? panWave :
    panNoise;
  if (panner?.pan?.value != null) panner.pan.value = 0;
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
    const semis = clamp((Number(payload.value) || 0) | 0, -12, 12);
    entry.tsp = tspByteFromSemis(semis);
    state.chains[activeChainId][row] = entry;
    return true;
  }
  const step = currentPhrase().steps[row];
  if (payload.type === "phrase.note") {
    step.note = normalizeNote(String(payload.value ?? "")) || "";
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
    if (prev === "O" && next !== "O") immediateCenterPanForStep(step);
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
    const semis = clamp((Number(value) || 0) | 0, -12, 12);
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
    step.note = normalizeNote(String(value ?? "")) || "";
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
    if (prev === "O" && next !== "O") immediateCenterPanForStep(step);
    setStatus(`Set CMD = ${next ?? "--"}`);
    return true;
  }
  if (type === "phrase.val") {
    step.val = value == null ? null : clampByte(value);
    ensureValSemantics(step);
    saveState();
    renderTracker({ force: true });
    setStatus(`Set VAL = ${displayValForStep(step)}`);
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
  const step = currentPhrase().steps[selRow];
  const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
  const start = noteNumberFromParts(parsed);
  const next = partsFromNoteNumber(start + (Number(delta) || 0));
  step.note = makeNote(next);
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${step.note}`);
}

function applyNoteOctaveDelta(delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
  const start = noteNumberFromParts(parsed);
  const next = partsFromNoteNumber(start + 12 * (Number(delta) || 0));
  step.note = makeNote(next);
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${step.note}`);
}

function applyNoteDelta({ pitchDelta = 0, octaveDelta = 0 }) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
  const next = {
    idx: parsed.idx + pitchDelta,
    octave: clamp(parsed.octave + octaveDelta, 0, 8),
  };
  step.note = makeNote(next);
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${step.note}`);
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

  // Tone.js pulse width is exposed differently depending on oscillator class.
  // We try a few compatible paths.
  const osc = synth.oscillator;
  if (osc?.width?.value != null) osc.width.value = p;
  if (osc?.width != null && typeof osc.width === "number") osc.width = p;
}

async function masterStart() {
  if (engineReady) return;
  await Tone.start();

  master = new Tone.Gain(0.9).toDestination();

  gainPulse1 = new Tone.Gain(0.9).connect(master);
  gainPulse2 = new Tone.Gain(0.9).connect(master);
  gainWave = new Tone.Gain(0.9).connect(master);
  gainNoise = new Tone.Gain(0.9).connect(master);

  panPulse1 = new Tone.Panner(0).connect(gainPulse1);
  panPulse2 = new Tone.Panner(0).connect(gainPulse2);
  panWave = new Tone.Panner(0).connect(gainWave);
  panNoise = new Tone.Panner(0).connect(gainNoise);

  synthPulse1 = new Tone.Synth({
    oscillator: { type: "pulse", width: 0.5 },
    envelope: { attack: 0.002, decay: 0.06, sustain: 0.0, release: 0.06 },
  }).connect(panPulse1);

  synthPulse2 = new Tone.Synth({
    oscillator: { type: "pulse", width: 0.5 },
    envelope: { attack: 0.002, decay: 0.06, sustain: 0.0, release: 0.06 },
  }).connect(panPulse2);

  synthWave = new Tone.Synth({
    oscillator: { type: state.wavType || "triangle" },
    envelope: { attack: 0.002, decay: 0.08, sustain: 0.0, release: 0.08 },
  }).connect(panWave);

  synthNoise = new Tone.NoiseSynth({
    noise: { type: state.noiseType || "white" },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.02 },
  }).connect(panNoise);

  // Apply saved UI settings
  Tone.Transport.bpm.value = state.bpm;
  applyPulseWidth(1, state.pulse1Width);
  applyPulseWidth(2, state.pulse2Width);
  applyInstrumentSettingsFromState();

  engineReady = true;
  syncMasterStartButtonUI();
  setStatus("Audio engine ready. Space to play.");
}

function applyInstrumentSettingsFromState() {
  // WAV / NOI
  if (synthWave?.oscillator?.type != null && typeof state.wavType === "string") {
    synthWave.oscillator.type = state.wavType;
  }
  if (synthNoise?.noise?.type != null && typeof state.noiseType === "string") {
    synthNoise.noise.type = state.noiseType;
  }

  // Mixer (0..100 -> 0..1)
  const vols = Array.isArray(state.mixVol) ? state.mixVol : [90, 90, 90, 90];
  const g0 = clamp((vols[0] ?? 90) / 100, 0, 1);
  const g1 = clamp((vols[1] ?? 90) / 100, 0, 1);
  const g2 = clamp((vols[2] ?? 90) / 100, 0, 1);
  const g3 = clamp((vols[3] ?? 90) / 100, 0, 1);
  if (gainPulse1?.gain?.value != null) gainPulse1.gain.value = g0;
  if (gainPulse2?.gain?.value != null) gainPulse2.gain.value = g1;
  if (gainWave?.gain?.value != null) gainWave.gain.value = g2;
  if (gainNoise?.gain?.value != null) gainNoise.gain.value = g3;
}

function instrToChannel(instrHex) {
  const idx = instrHex == null ? 0 : clamp(instrHex | 0, 0, 31);
  ensureInstrumentsInState(state);
  const t = state.instruments[idx]?.type ?? 0;
  if (t === 0) return idx & 1; // Pulse → alternate PU1 / PU2
  if (t === 1) return 2; // Wave
  return 3; // Noise
}

function cmdVolumeToVelocity(valByte) {
  const v = valByte == null ? 0x0f : clamp(valByte | 0, 0, 255);
  const nib = clamp(v & 0x0f, 0, 15);
  return clamp(nib / 15, 0, 1);
}

function pitchSignedSemitones(valByte) {
  if (valByte == null) return 0;
  const v = clamp(valByte | 0, 0, 255);
  // Signed int8
  const signed = v >= 0x80 ? v - 0x100 : v;
  // Limit to something musical
  return clamp(signed, -24, 24);
}

function retriggerCount(valByte) {
  if (valByte == null) return 0;
  const v = clamp(valByte | 0, 0, 255);
  // 01..10 => 1..16 retriggers; 00 => none
  return clamp(v, 0, 16);
}

function panFromByte(valByte) {
  const v = valByte == null ? 0x80 : clamp(valByte | 0, 0, 255);
  // 00 => -1 (L), 80 => 0 (C), FF => +1 (R)
  const pan = (v - 0x80) / 0x7f;
  return clamp(pan, -1, 1);
}

function widthFromByte(valByte) {
  const v = valByte == null ? 0x02 : clamp(valByte | 0, 0, 255);
  const code = v & 0x03;
  if (code === 0x00) return 0.125;
  if (code === 0x01) return 0.25;
  if (code === 0x02) return 0.5;
  return 0.75;
}

function applyPulseWidthAtTime(synth, width, time) {
  if (!synth?.oscillator) return;
  const osc = synth.oscillator;
  if (osc?.width?.setValueAtTime) osc.width.setValueAtTime(width, time);
  else if (osc?.width?.value != null) osc.width.value = width;
  else if (osc?.width != null && typeof osc.width === "number") osc.width = width;
}

function transposeNoteBySemis(note, semis) {
  try {
    return Tone.Frequency(note).transpose(semis);
  } catch {
    return note;
  }
}

function triggerStep(step, time, stepDurSec, opts = {}) {
  if (!step) return;
  const transposeSemis = Number.isFinite(opts.transposeSemis) ? opts.transposeSemis : 0;
  const cmd = normalizeCmd(step.cmd);
  if (!step.note && cmd !== "D" && cmd !== "T") return;

  const channel = Number.isFinite(opts.channelOverride) ? clamp(opts.channelOverride | 0, 0, 3) : instrToChannel(step.instr);
  const valByte = step.val;

  let vel = 0.9;
  if (cmd === "V") vel = cmdVolumeToVelocity(valByte);

  const semis = cmd === "P" ? pitchSignedSemitones(valByte) : 0;

  const synth =
    channel === 0 ? synthPulse1 :
    channel === 1 ? synthPulse2 :
    channel === 2 ? synthWave :
    synthNoise;

  if (!synth) return;

  const panner =
    channel === 0 ? panPulse1 :
    channel === 1 ? panPulse2 :
    channel === 2 ? panWave :
    panNoise;

  // LSDj-style default: center pan unless 'O' explicitly sets it.
  const nextPan = cmd === "O" ? panFromByte(valByte) : 0;
  if (panner?.pan?.setValueAtTime) {
    panner.pan.setValueAtTime(nextPan, time);
  } else if (panner?.pan?.value != null) {
    panner.pan.value = nextPan;
  }

  if (cmd === "W" && (channel === 0 || channel === 1)) {
    const w = widthFromByte(valByte);
    applyPulseWidthAtTime(channel === 0 ? synthPulse1 : synthPulse2, w, time);
  }

  if (cmd === "T") {
    const raw = valByte == null ? state.bpm : clamp(valByte | 0, 0, 255);
    const bpm = clamp(raw, BPM_RANGE_MIN, BPM_RANGE_MAX);
    if (Tone.Transport?.bpm?.setValueAtTime) Tone.Transport.bpm.setValueAtTime(bpm, time);
    else if (Tone.Transport?.bpm?.value != null) Tone.Transport.bpm.value = bpm;
    return;
  }

  // D: retrigger within the step. When note is empty and D is used on noise channel,
  // still produce a roll.
  if (cmd === "D") {
    const count = retriggerCount(valByte);
    if (count <= 0) return;
    const sub = stepDurSec / count;
    for (let i = 0; i < count; i++) {
      const t = time + i * sub;
      if (synth === synthNoise) {
        synth.triggerAttackRelease(sub * 0.85, t, vel);
      } else if (step.note) {
        synth.triggerAttackRelease(step.note, sub * 0.85, t, vel);
      }
    }
    return;
  }

  if (synth === synthNoise) {
    synth.triggerAttackRelease(stepDurSec * 0.85, time, vel);
    return;
  }

  if (!step.note) return;
  const baseNote = transposeSemis !== 0 ? transposeNoteBySemis(step.note, transposeSemis) : step.note;
  if (cmd === "A") {
    const v = valByte == null ? 0x00 : clamp(valByte | 0, 0, 255);
    const x = (v >> 4) & 0x0f;
    const y = v & 0x0f;
    const notes = [
      transposeNoteBySemis(baseNote, 0),
      transposeNoteBySemis(baseNote, x),
      transposeNoteBySemis(baseNote, y),
    ];
    const sub = stepDurSec / 3;
    for (let i = 0; i < 3; i++) {
      synth.triggerAttackRelease(notes[i], sub * 0.85, time + i * sub, vel);
    }
  } else {
    synth.triggerAttackRelease(baseNote, stepDurSec * 0.85, time, vel);
  }

  // P: pitch slide in cents over the step duration, then reset.
  if (cmd === "P" && semis !== 0) {
    const detuneCents = semis * 100;
    if (synth.detune?.value != null) {
      synth.detune.setValueAtTime(0, time);
      synth.detune.linearRampToValueAtTime(detuneCents, time + stepDurSec * 0.9);
      synth.detune.setValueAtTime(0, time + stepDurSec);
    }
  }
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
  return Math.max(0, getOutputLatencySeconds() + (Number(state.visualOffsetMs) || 0) / 1000);
}

/**
 * Defer playhead UI until roughly when this step is heard (output latency + manual offset).
 * @param {number} audioContextEventTime
 * @param {number} scheduleGen
 * @param {"P"|"C"|"S"} mode
 * @param {() => void} fn
 */
function scheduleDeferredPlayheadUpdate(audioContextEventTime, scheduleGen, mode, fn) {
  const when = audioContextEventTime + getTotalPlayheadDelaySeconds();
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
    if (phrasePlayheadAnchorTime == null) phrasePlayheadAnchorTime = time;
    const row = idx % ROWS;

    const step = currentPhrase().steps[row];
    triggerStep(step, time, stepDur);

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
      if (step) triggerStep(step, time, stepDur, { transposeSemis: semisFromTspByte(entry.tsp) });

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
        if (step) triggerStep(step, time, stepDur, { channelOverride: t, transposeSemis: semisFromTspByte(entry.tsp) });
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

  isPlaying = false;
  playheadScheduleGen += 1;
  stopPhrasePlayheadRaf();
  syncPlayButtonUI();
  if (stepEventId != null) {
    Tone.Transport.clear(stepEventId);
    stepEventId = null;
  }
  Tone.Transport.stop();
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

  setActiveScreen(activeScreen);
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
  activeScreen = "P";
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
      e.preventDefault();
      const scr = btn.getAttribute("data-screen");
      if (scr) handleNavClick(scr);
    }, { passive: false });
  });

  elMasterStart.addEventListener("click", () => {
    masterStart().catch(() => setStatus("Failed to start audio context."));
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

renderTracker();
initUI();
syncGhostSelectToSelection();
setStatusCursor();
focusMain();
