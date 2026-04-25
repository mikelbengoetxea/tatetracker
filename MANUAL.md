## Manual: Entering Notes + Editing

### Core navigation (LSDj-style)

- **Arrow keys (D-Pad)**: move the cursor highlight across the grid cells
- **Z (Button A)**: modifier/action (hold to edit with arrows)
- **X (Button B)**: delete/clear the current cell
- **Enter (Start)**: play/pause (after **Master Start**)
- **Right Shift (Select)**: reserved for screen navigation / secondary modifiers (tracked)

### Editing a cell (no typing)

- Move to the target cell with **Arrow keys**
- **Hold Z** and press **Arrow keys** to change the value (see rules below)
- Press **X** to clear the selected cell (sets it empty)

Notes:

- The **Row** column is not editable (it’s just the step label).
- The app auto-saves to `localStorage` **on every committed edit** and on every clear.

---

## Note column (how to enter notes)

### Z + arrows note entry

With the cursor on a Note cell:

- **Hold Z + Up/Down**: cycle chromatic pitch (`C`, `C#`, `D`, ... `B`)
- **Hold Z + Left/Right**: change octave (0–8)

### Clearing a note

- Press **X** on the Note cell

---

## Hex fields (Instr / Cmd / Val)

These columns are edited as **2-digit hex bytes**:

- Valid: `00`, `0A`, `1F`, `80`, `FF`
- Empty shows `--`

With the cursor on Instr/Cmd/Val:

- **Hold Z + Up/Down**: increment/decrement by **1**
- **Hold Z + Left/Right**: increment/decrement by **16** (fast scroll)

---

## Cmd + FX quick reference

### `V` Volume (Cmd = `01`)

- **Cmd**: `V`
- **Val**: volume uses the **low nibble** (`0..F`)
  - Example: `V 0F` = loudest, `V 00` = silent

### `P` Pitch slide (Cmd = `02`)

- **Cmd**: `P`
- **Val**: signed int8 semitone slide (clamped to ±24 semitones)
  - Example: `P 02` slides up 2 semitones over the step
  - Example: `P FE` (= -2) slides down 2 semitones over the step

### `D` Retrigger (Cmd = `03`)

- **Cmd**: `D`
- **Val**: `01`..`10` = 1..16 triggers inside the step
  - Example: `D 08` = 8 rapid retriggers within that row
  - Tip: try `Instr 03` (Noise channel) + `D` for snare/hat rolls

---

## Instrument mapping (current behavior)

Right now `Instr` selects the channel by the lowest 2 bits:

- `00` → Pulse 1
- `01` → Pulse 2
- `02` → Wave (triangle)
- `03` → Noise

So `04` behaves like `00`, `05` like `01`, etc.
