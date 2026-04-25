## Tate Tracker

Keyboard-driven HTML5 music tracker inspired by LSDj/M8 workflows.

### Run it

- **Option A (Python)**:

```bash
python3 -m http.server 5173
```

- **Option B (Node)**:

```bash
npx serve .
```

Then open `http://localhost:5173`.

### Controls

- **Master Start**: required once (browser autoplay policy)
- **Arrows (D-Pad)**: move cursor
- **Hold Z (A) + Arrows**: edit (note cycle / hex inc-dec)
- **X (B)**: clear cell
- **Enter (Start)**: play/pause

### Manual

See `MANUAL.md` for note entry + editing rules and examples.

### Pattern format

- **Rows**: 16 steps, labeled hex `00`..`0F`
- **Columns**: Note / Instr / Cmd / Val
- **Hex**: all fields except Note are 2-digit hex (`00`..`FF`)

### FX

- **V**: Volume (uses low nibble of `Val` = 0..F)
- **P**: Pitch slide (signed `Val` as int8 semitones, clamped to ±24)
- **D**: Delay/Retrigger (Val 01..10 => 1..16 triggers inside the step)

### Save / Share

- Auto-saves to `localStorage` on every edit.
- Export generates a Base64 string of the entire JSON state and copies it to clipboard.
- Import pastes a Base64 string back into state (press Enter in the Import field).
