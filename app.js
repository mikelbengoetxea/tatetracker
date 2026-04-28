/* global Tone */

const STORAGE_KEY = "tate-tracker:v1";

const ROWS = 16;
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
  { key: "instr", label: "Instr", kind: "byte" },
  { key: "cmd", label: "Cmd", kind: "cmd" },
  { key: "val", label: "Val", kind: "byte" },
];

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
  return {
    bpm: 120,
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
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const s = defaultState();

    if (Number.isFinite(parsed?.bpm)) s.bpm = clamp(parsed.bpm, 30, 300);
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

    return s;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

// Selection
let selRow = 0;
let selCol = 1; // default to Note
let isPlaying = false;
let playRow = -1;

// Modifier tracking
let isZPressed = false;
let isXPressed = false;

// UI elements
const elTracker = document.getElementById("tracker");
const elStatusLeft = document.getElementById("statusLeft");
const elStatusRight = document.getElementById("statusRight");
const elMasterStart = document.getElementById("masterStartBtn");
const elPlay = document.getElementById("playBtn");
const elBpm = document.getElementById("bpmInput");
const elExport = document.getElementById("exportBtn");
const elImport = document.getElementById("importInput");
const elReset = document.getElementById("resetBtn");
const elPulse1Width = document.getElementById("pulse1Width");
const elPulse2Width = document.getElementById("pulse2Width");
const elPhraseView = document.getElementById("phraseView");
const elSongView = document.getElementById("songView");
const elChainView = document.getElementById("chainView");
const elInstrumentView = document.getElementById("instrumentView");
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

let playChainRow = -1;
let playSongRow = -1;
let playMode = "P"; // "P" | "C" | "S"

function setStatus(msg) {
  elStatusLeft.textContent = msg;
}

function syncPlayButtonUI() {
  if (!elPlay) return;
  elPlay.textContent = isPlaying ? "⏸" : "▶";
}

function setStatusCursor() {
  if (activeScreen === "P") {
    const colLabel = COLS[selCol]?.label ?? "--";
    elStatusRight.textContent = `Row ${rowHex(selRow)}  Col ${colLabel}`;
    return;
  }
  if (activeScreen === "S") {
    elStatusRight.textContent = `Song ${SONG_COLS[songSelCol]?.key ?? "--"} Row ${rowHex(songSelRow)}`;
    return;
  }
  if (activeScreen === "C") {
    elStatusRight.textContent = `Chain ${CHAIN_COLS[chainSelCol]?.key ?? "--"} Row ${rowHex(chainSelRow)}`;
    return;
  }
  if (activeScreen === "I") {
    elStatusRight.textContent = `Instrument`;
    return;
  }
  elStatusRight.textContent = `--`;
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
  if (value == null) return 0x00;
  const v = clamp(value | 0, 0, 255);
  return clamp(v, 0, 3);
}

function displayInstr(value) {
  return toHex2(normalizeInstr(value));
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
    <div class="list16__cell">PU1</div>
    <div class="list16__cell">PU2</div>
    <div class="list16__cell">WAV</div>
    <div class="list16__cell">NOI</div>
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
      row.appendChild(cell);
    }
    list.appendChild(row);
  }
  elSongView.appendChild(list);
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
    <div class="list16__cell">PHR</div>
    <div class="list16__cell">TSP</div>
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

    const cT = document.createElement("div");
    cT.className = "list16__cell editcell";
    cT.textContent = formatTsp(entry.tsp);
    cT.dataset.screen = "C";
    cT.dataset.row = String(r);
    cT.dataset.col = "1";
    if (r === chainSelRow && chainSelCol === 1) cT.classList.add("list16__cell--selected");

    row.appendChild(c0);
    row.appendChild(cP);
    row.appendChild(cT);
    list.appendChild(row);
  }
  elChainView.appendChild(list);
}

function setActiveScreen(next) {
  if (!next || !SCREEN_NAMES[next] || next === activeScreen) return;
  activeScreen = next;

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
  if (elScreenId) {
    if (activeScreen === "S") elScreenId.textContent = "Song";
    else if (activeScreen === "C") elScreenId.textContent = chainLabel(activeChainId);
    else if (activeScreen === "P") elScreenId.textContent = phraseLabel(activePhraseId);
    else elScreenId.textContent = "--";
  }

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
  renderNavMap();
}

function renderInstrumentView() {
  // Static HTML already exists; we just sync UI -> state.
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
  setStatusCursor();
}

function drillDown() {
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
  if (activeScreen !== "P") return;
  if (selCol === 0) {
    setStatus("Row column is not editable.");
    return;
  }
  const step = currentPhrase().steps[selRow];
  const key = COLS[selCol].key;
  if (key === "note") step.note = "";
  if (key === "instr") step.instr = 0x00;
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
    const cur = normalizeInstr(step.instr);
    const next = clamp(cur + delta, 0, 3);
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

function applyNoteSemitoneDelta(delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
  const nextIdx = clamp(parsed.idx + delta, 0, 11);
  step.note = makeNote({ idx: nextIdx, octave: parsed.octave });
  saveState();
  renderTracker();
  setStatus(`NOTE @ ${rowHex(selRow)} = ${step.note}`);
}

function applyNoteOctaveDelta(delta) {
  if (activeScreen !== "P") return;
  const step = currentPhrase().steps[selRow];
  const parsed = parseNote(step.note) ?? { idx: 0, octave: 4 };
  const nextOct = clamp(parsed.octave + delta, 0, 8);
  step.note = makeNote({ idx: parsed.idx, octave: nextOct });
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

function applyBpmFromUI() {
  const bpm = clamp(parseInt(elBpm.value, 10) || 120, 30, 300);
  state.bpm = bpm;
  saveState();
  if (engineReady) Tone.Transport.bpm.value = bpm;
  setStatus(`BPM = ${bpm}.`);
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
  const v = instrHex == null ? 0 : clamp(instrHex | 0, 0, 255);
  const idx = v & 0x03; // 00..03 map to 4 channels
  return idx;
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
    const bpm = clamp(raw, 30, 300);
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

  const stepDur = Tone.Time("16n").toSeconds();
  let idx = 0;

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const row = idx % ROWS;
    playRow = row;
    applyPlayheadUI();

    const step = currentPhrase().steps[row];
    triggerStep(step, time, stepDur);

    idx++;
  }, "16n");

  Tone.Transport.start();
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

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const chain = state.chains?.[activeChainId] ?? [];
    let entry = normalizeChainRow(chain[chainRow]);
    let phraseId = entry.phraseId;
    if (phraseId == null) {
      chainRow = 0;
      entry = normalizeChainRow(chain[chainRow]);
      phraseId = entry.phraseId;
      playChainRow = chainRow;
      if (activeScreen === "C") renderChainView();
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
      playChainRow = chainRow;
      if (activeScreen === "C") renderChainView();
      stepIdx = 0;
    } else {
      stepIdx++;
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

  const stepDur = Tone.Time("16n").toSeconds();
  let stepIdx = 0;
  let songRow = 0;
  let chainRow = 0;

  stepEventId = Tone.Transport.scheduleRepeat((time) => {
    const songEntry = state.song?.[songRow];
    const chainIds = Array.isArray(songEntry) ? songEntry : SONG_COLS.map((_, c) => (c === 0 ? songEntry : null));

    const hasAny = chainIds?.some((v) => v != null);
    if (!hasAny) {
      songRow = 0;
      chainRow = 0;
      playSongRow = songRow;
      playSongRow = songRow;
      if (activeScreen === "S") renderSongView();
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
        playSongRow = songRow;
        if (activeScreen === "S") renderSongView();
      } else {
        chainRow = nextChainRow;
      }
      stepIdx = 0;
    } else {
      stepIdx++;
    }
  }, "16n");

  Tone.Transport.start();
  setStatus("Playing Song. Enter to pause.");
}

function stopPlayback() {
  if (!engineReady) return;
  if (!isPlaying) return;

  isPlaying = false;
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

function exportSongCode() {
  const json = JSON.stringify(state);
  navigator.clipboard?.writeText(json).catch(() => {});
  setStatus("COPIED");
}

function importSongCode(code) {
  try {
    const parsed = JSON.parse(String(code ?? "").trim());
    state = coerceProjectState(parsed);
    afterProjectLoaded("Imported project JSON.");
  } catch {
    setStatus("Import failed. Invalid JSON.");
  }
}

function coerceProjectState(parsed) {
  const s = defaultState();
  if (!parsed || typeof parsed !== "object") return s;

  if (Number.isFinite(parsed?.bpm)) s.bpm = clamp(parsed.bpm, 30, 300);
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
  if (!s.phrases[0x00]) s.phrases[0x00] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: 0x00, cmd: null, val: null })) };

  return s;
}

function afterProjectLoaded(msg) {
  saveState();
  if (elBpm) elBpm.value = String(state.bpm);
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
    state.phrases[activePhraseId] = { steps: Array.from({ length: ROWS }, () => ({ note: "", instr: 0x00, cmd: null, val: null })) };
  }

  setActiveScreen(activeScreen);
  // Force all views to reflect new global state immediately.
  renderTracker({ force: true });
  renderSongView({ force: true });
  renderChainView({ force: true });
  renderInstrumentView();
  setStatus(msg);
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
  playRow = -1;
  playChainRow = -1;
  playSongRow = -1;
  playMode = "P";
  isZPressed = false;
  isXPressed = false;
  keyState.a = false;
  keyState.select = false;

  if (elImport) elImport.value = "";
  afterProjectLoaded("Reset project to default state.");
}

function initUI() {
  elBpm.value = String(state.bpm);
  elPulse1Width.value = String(state.pulse1Width);
  elPulse2Width.value = String(state.pulse2Width);
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

  elBpm.addEventListener("change", () => applyBpmFromUI());
  elPulse1Width.addEventListener("change", () => {
    state.pulse1Width = Number(elPulse1Width.value);
    saveState();
    applyPulseWidth(1, state.pulse1Width);
    setStatus(`Pulse 1 Width = ${state.pulse1Width}%.`);
  });
  elPulse2Width.addEventListener("change", () => {
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

  elExport.addEventListener("click", () => exportSongCode());
  elImport.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    importSongCode(elImport.value);
    elImport.select();
  });
  elReset?.addEventListener("click", () => resetProject());

  // Click selects cell (still keyboard-first, but this makes it debuggable)
  elTracker.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const r = Number(target.dataset.row);
    const c = Number(target.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    if (c === 0) return; // don't allow selecting Row index column
    selRow = clamp(r, 0, ROWS - 1);
    selCol = clamp(c, 0, COLS.length - 1);
    applySelectionUI();
    focusMain();
  });

  // Vertical scrubbing on grid cells (mouse + touch)
  const MOUSE_SCRUB_STEP_PX = 18; // less twitchy on desktop
  const TOUCH_SCRUB_STEP_PX = 12; // slightly more sensitive for fingers
  const scrub = {
    active: false,
    row: 0,
    col: 0,
    acc: 0,
    accX: 0,
    lastY: 0,
    lastX: 0,
  startY: 0,
  startX: 0,
  appliedYSteps: 0,
  appliedXSteps: 0,
    pointerType: "mouse",
    justStoppedAt: 0,
    didMove: false,
  };

  let globalTouchBound = false;
  function bindGlobalTouch() {
    if (globalTouchBound) return;
    globalTouchBound = true;
    window.addEventListener("touchmove", handleGlobalTouchMove, { passive: false });
    window.addEventListener("touchend", handleGlobalTouchEnd, { passive: false });
    window.addEventListener("touchcancel", handleGlobalTouchEnd, { passive: false });
  }
  function unbindGlobalTouch() {
    if (!globalTouchBound) return;
    globalTouchBound = false;
    window.removeEventListener("touchmove", handleGlobalTouchMove);
    window.removeEventListener("touchend", handleGlobalTouchEnd);
    window.removeEventListener("touchcancel", handleGlobalTouchEnd);
  }

  function scrubStop() {
    if (!scrub.active) return;
    scrub.active = false;
    scrub.acc = 0;
    scrub.accX = 0;
    scrub.justStoppedAt = Date.now();
    scrub.didMove = false;
    scrub.startY = 0;
    scrub.startX = 0;
    scrub.appliedYSteps = 0;
    scrub.appliedXSteps = 0;
    if (scrub.pointerType === "touch") unbindGlobalTouch();
    const el = elTracker.querySelector(`.cell[data-row="${scrub.row}"][data-col="${scrub.col}"]`);
    if (el) el.classList.remove("cell--scrubbing");
    // Also clear from Song/Chain cells if scrubbing there.
    elSongView?.querySelectorAll(".cell--scrubbing").forEach((n) => n.classList.remove("cell--scrubbing"));
    elChainView?.querySelectorAll(".cell--scrubbing").forEach((n) => n.classList.remove("cell--scrubbing"));
  }

  function resetAt(screen, row, col) {
    if (screen === "P") {
      const key = COLS[col]?.key;
      if (!key || key === "row") return;
      selRow = clamp(row, 0, ROWS - 1);
      selCol = clamp(col, 0, COLS.length - 1);
      const step = currentPhrase().steps[selRow];
      if (key === "note") step.note = "";
      if (key === "instr") step.instr = 0x00;
      if (key === "cmd") { step.cmd = null; step.val = null; }
      if (key === "val") step.val = normalizeCmd(step.cmd) ? 0x00 : null;
      step.instr = normalizeInstr(step.instr);
      ensureValSemantics(step);
      saveState();
      renderTracker();
      setStatus(`Reset ${COLS[selCol].label} @ ${rowHex(selRow)}.`);
      return;
    }
    if (screen === "S") {
      songSelRow = clamp(row, 0, ROWS - 1);
      songSelCol = clamp(col ?? 0, 0, SONG_COLS.length - 1);
      const r = state.song?.[songSelRow];
      if (Array.isArray(r)) r[songSelCol] = null;
      else if (songSelCol === 0) state.song[songSelRow] = null;
      saveState();
      renderSongView();
      setStatus(`Reset Song ${SONG_COLS[songSelCol]?.key ?? "--"} @ ${rowHex(songSelRow)}.`);
      return;
    }
    if (screen === "C") {
      chainSelRow = clamp(row, 0, ROWS - 1);
      chainSelCol = clamp(col ?? 0, 0, 1);
      const chain = state.chains?.[activeChainId] ?? Array.from({ length: ROWS }, () => emptyChainRow());
      state.chains[activeChainId] = chain.map((r) => normalizeChainRow(r));
      const entry = normalizeChainRow(state.chains[activeChainId][chainSelRow]);
      if (chainSelCol === 0) entry.phraseId = null;
      if (chainSelCol === 1) entry.tsp = 0x00;
      state.chains[activeChainId][chainSelRow] = entry;
      saveState();
      renderChainView();
      setStatus(`Reset Chain ${idHex(activeChainId)} ${CHAIN_COLS[chainSelCol]?.key ?? "--"} @ ${rowHex(chainSelRow)}.`);
    }
  }

  function scrubApply(steps) {
    if (steps === 0) return;
    if (scrub.screen === "S") {
      songSelRow = clamp(scrub.row, 0, ROWS - 1);
      songSelCol = clamp(scrub.col, 0, SONG_COLS.length - 1);
      applySongHexDelta(steps);
      return;
    }
    if (scrub.screen === "C") {
      chainSelRow = clamp(scrub.row, 0, ROWS - 1);
      chainSelCol = clamp(scrub.col, 0, 1);
      applyChainHexDelta(steps);
      return;
    }

    const colKey = COLS[scrub.col]?.key;
    if (!colKey) return;

    // Move selection to the scrubbed cell (for consistent status + shared mutators)
    selRow = clamp(scrub.row, 0, ROWS - 1);
    selCol = clamp(scrub.col, 0, COLS.length - 1);

    if (colKey === "note") {
      applyNoteSemitoneDelta(steps);
      return;
    }
    if (colKey === "instr") {
      applyByteDelta("instr", steps);
      return;
    }
    if (colKey === "val") {
      applyByteDelta("val", steps);
      return;
    }
    if (colKey === "cmd") {
      applyCmdDelta(steps);
      return;
    }
  }

  function scrubMoveTo(clientX, clientY) {
    if (!scrub.active) return;
    const dyFromStart = clientY - scrub.startY;
    const dxFromStart = clientX - scrub.startX;
    if (Math.abs(dxFromStart) + Math.abs(dyFromStart) > 0) scrub.didMove = true;

    // desired steps are based on the initial touch point (prevents "ghost scrubbing")
    const stepPx = scrub.pointerType === "mouse" ? MOUSE_SCRUB_STEP_PX : TOUCH_SCRUB_STEP_PX;
    const desiredYSteps = Math.trunc((-dyFromStart) / stepPx);
    const desiredXSteps = Math.trunc((dxFromStart) / stepPx);
    const deltaY = desiredYSteps - (scrub.appliedYSteps || 0);
    const deltaX = desiredXSteps - (scrub.appliedXSteps || 0);
    scrub.appliedYSteps = desiredYSteps;
    scrub.appliedXSteps = desiredXSteps;

    // Up (negative dy) => increment; down => decrement.
    if (scrub.screen === "P" && COLS[scrub.col]?.key === "note") {
      if (deltaY !== 0) applyNoteOctaveDelta(deltaY);
      if (deltaX !== 0) applyNoteSemitoneDelta(deltaX);
      return;
    }
    if (deltaY !== 0) scrubApply(deltaY);
  }

  function scrubStartFromTarget(target, clientX, clientY, pointerType) {
    if (!(target instanceof HTMLElement)) return;
    const phraseCell = target.classList.contains("cell") ? target : target.closest(".cell");
    const listCell = target.classList.contains("list16__cell") ? target : target.closest(".list16__cell");

    let screen = null;
    let r = null;
    let c = null;
    let elToMark = null;

    if (activeScreen === "P" && phraseCell) {
      r = Number(phraseCell.dataset.row);
      c = Number(phraseCell.dataset.col);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      if (COLS[c]?.key === "row") return;
      if (!phraseCell.classList.contains("editcell")) return;
      screen = "P";
      elToMark = phraseCell;
    } else if (activeScreen === "S" && listCell) {
      if (!listCell.classList.contains("editcell")) return;
      r = Number(listCell.dataset.row);
      if (!Number.isFinite(r)) return;
      screen = "S";
      c = Number(listCell.dataset.col);
      if (!Number.isFinite(c)) return;
      elToMark = listCell;
    } else if (activeScreen === "C" && listCell) {
      if (!listCell.classList.contains("editcell")) return;
      r = Number(listCell.dataset.row);
      if (!Number.isFinite(r)) return;
      screen = "C";
      c = Number(listCell.dataset.col);
      if (!Number.isFinite(c)) return;
      elToMark = listCell;
    } else {
      return;
    }

    scrub.active = true;
    scrub.screen = screen;
    scrub.row = clamp(r, 0, ROWS - 1);
    scrub.col = clamp(c, 0, COLS.length - 1);
    scrub.acc = 0;
    scrub.accX = 0;
    scrub.startY = clientY;
    scrub.startX = clientX;
    scrub.appliedYSteps = 0;
    scrub.appliedXSteps = 0;
    scrub.lastY = clientY;
    scrub.lastX = clientX;
    scrub.pointerType = pointerType;
    scrub.didMove = false;
    if (pointerType === "touch") bindGlobalTouch();

    elToMark?.classList.add("cell--scrubbing");
    if (screen === "P") {
      selRow = scrub.row;
      selCol = scrub.col;
      applySelectionUI();
    } else if (screen === "S") {
      songSelRow = scrub.row;
      songSelCol = clamp(scrub.col, 0, SONG_COLS.length - 1);
      renderSongView();
      setStatusCursor();
    } else if (screen === "C") {
      chainSelRow = scrub.row;
      chainSelCol = clamp(scrub.col, 0, 1);
      renderChainView();
      setStatusCursor();
    }
  }

  elTracker.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    holdStartFromTarget(e.target, e.clientX, e.clientY, "mouse");
    scrubStartFromTarget(e.target, e.clientX, e.clientY, "mouse");
  });
  window.addEventListener("mousemove", (e) => {
    if (!scrub.active || scrub.pointerType !== "mouse") return;
    holdMaybeCancel(e.clientX, e.clientY);
    scrubMoveTo(e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", () => {
    if (scrub.pointerType === "mouse") scrubStop();
    holdClear();
  });

  elTracker.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    holdStartFromTarget(e.target, t.clientX, t.clientY, "touch");
    scrubStartFromTarget(e.target, t.clientX, t.clientY, "touch");
  }, { passive: false });
  elTracker.addEventListener("touchmove", (e) => {
    if (!scrub.active || scrub.pointerType !== "touch") return;
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    holdMaybeCancel(t.clientX, t.clientY);
    scrubMoveTo(t.clientX, t.clientY);
  }, { passive: false });
  elTracker.addEventListener("touchend", (e) => {
    if (scrub.active && scrub.pointerType === "touch") {
      e.preventDefault();
      scrubStop();
      holdClear();
    }
  }, { passive: false });
  elTracker.addEventListener("touchcancel", (e) => {
    if (scrub.active && scrub.pointerType === "touch") {
      e.preventDefault();
      scrubStop();
      holdClear();
    }
  }, { passive: false });

  // Global touch handlers are bound only while scrubbing (prevents "freeze" due to broad preventDefault).
  function handleGlobalTouchMove(e) {
    if (!scrub.active || scrub.pointerType !== "touch") return;
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    holdMaybeCancel(t.clientX, t.clientY);
    scrubMoveTo(t.clientX, t.clientY);
  }
  function handleGlobalTouchEnd(e) {
    if (!scrub.active || scrub.pointerType !== "touch") return;
    e.preventDefault();
    scrubStop();
    holdClear();
  }

  // Scroll-lock + scrubbing for Song/Chain lists (mobile)
  function bindTouchScrub(el) {
    if (!el) return;
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      holdStartFromTarget(e.target, t.clientX, t.clientY, "touch");
      scrubStartFromTarget(e.target, t.clientX, t.clientY, "touch");
    }, { passive: false });
    el.addEventListener("touchmove", (e) => {
      if (!scrub.active || scrub.pointerType !== "touch") return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      holdMaybeCancel(t.clientX, t.clientY);
      scrubMoveTo(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      if (scrub.pointerType === "touch") scrubStop();
      holdClear();
      // Passive selection on tap (no drag), without activating values.
      if (!scrub.didMove && Date.now() >= suppressClickUntil) {
        selectFromTarget(e.target);
      }
    }, { passive: false });
    el.addEventListener("touchcancel", (e) => {
      e.preventDefault();
      if (scrub.pointerType === "touch") scrubStop();
      holdClear();
    }, { passive: false });
  }
  bindTouchScrub(elSongView);
  bindTouchScrub(elChainView);

  function bindMouseScrub(el) {
    if (!el) return;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      holdStartFromTarget(e.target, e.clientX, e.clientY, "mouse");
      scrubStartFromTarget(e.target, e.clientX, e.clientY, "mouse");
    });
  }
  bindMouseScrub(elSongView);
  bindMouseScrub(elChainView);

  // Long-press (500ms) reset for mouse + touch (replaces dblclick/double-tap).
  const HOLD_MS = 500;
  const HOLD_CANCEL_PX = 6;
  let suppressClickUntil = 0;
  const hold = {
    timer: null,
    active: false,
    startX: 0,
    startY: 0,
    screen: null,
    row: -1,
    col: -1,
    el: null,
    pointerType: "mouse",
  };

  function holdClear() {
    if (hold.timer) window.clearTimeout(hold.timer);
    hold.timer = null;
    hold.active = false;
    if (hold.el) hold.el.classList.remove("editcell--holding");
    hold.el = null;
  }

  function holdStartFromTarget(target, clientX, clientY, pointerType) {
    if (!(target instanceof HTMLElement)) return;
    const phraseCell = target.classList.contains("cell") ? target : target.closest(".cell");
    const listCell = target.classList.contains("list16__cell") ? target : target.closest(".list16__cell");

    let screen = null;
    let row = -1;
    let col = -1;
    let el = null;

    if (activeScreen === "P" && phraseCell) {
      row = Number(phraseCell.dataset.row);
      col = Number(phraseCell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col) || col === 0) return;
      screen = "P";
      el = phraseCell;
    } else if (activeScreen === "S" && listCell && listCell.dataset.screen === "S") {
      row = Number(listCell.dataset.row);
      col = Number(listCell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      screen = "S";
      el = listCell;
    } else if (activeScreen === "C" && listCell && listCell.dataset.screen === "C") {
      row = Number(listCell.dataset.row);
      col = Number(listCell.dataset.col);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      screen = "C";
      el = listCell;
    } else {
      return;
    }

    holdClear();
    hold.active = true;
    hold.startX = clientX;
    hold.startY = clientY;
    hold.screen = screen;
    hold.row = row;
    hold.col = col;
    hold.el = el;
    hold.pointerType = pointerType;
    el.classList.add("editcell--holding");

    hold.timer = window.setTimeout(() => {
      resetAt(screen, row, col);
      suppressClickUntil = Date.now() + 350;
      holdClear();
    }, HOLD_MS);
  }

  function holdMaybeCancel(clientX, clientY) {
    if (!hold.active) return;
    const dx = clientX - hold.startX;
    const dy = clientY - hold.startY;
    if (Math.hypot(dx, dy) >= HOLD_CANCEL_PX) holdClear();
  }

  function selectFromTarget(target) {
    if (!(target instanceof HTMLElement)) return;
    if (Date.now() < suppressClickUntil) return;
    const listCell = target.classList.contains("list16__cell") ? target : target.closest(".list16__cell");
    if (!listCell) return;
    const screen = listCell.dataset.screen;
    const r = Number(listCell.dataset.row);
    const c = Number(listCell.dataset.col);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    if (screen === "S") {
      songSelRow = clamp(r, 0, ROWS - 1);
      songSelCol = clamp(c, 0, SONG_COLS.length - 1);
      renderSongView();
      setStatusCursor();
    } else if (screen === "C") {
      chainSelRow = clamp(r, 0, ROWS - 1);
      chainSelCol = clamp(c, 0, 1);
      renderChainView();
      setStatusCursor();
    }
  }

  elSongView?.addEventListener("click", (e) => selectFromTarget(e.target));
  elChainView?.addEventListener("click", (e) => selectFromTarget(e.target));

  function handleKeyDown(e) {
    if (document.activeElement === elImport || document.activeElement === elBpm) return;

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
        if (activeScreen === "P") resetAt("P", selRow, selCol);
        else if (activeScreen === "S") resetAt("S", songSelRow, songSelCol);
        else if (activeScreen === "C") resetAt("C", chainSelRow, chainSelCol);
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
}

renderTracker();
initUI();
setStatusCursor();
focusMain();
