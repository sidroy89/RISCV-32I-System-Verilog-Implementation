# RISC-V SC Visualizer — State of the Visual

## File Structure
```
visual/
  index.html       — page structure, SVG defs, modals
  css/style.css    — all styling (dark/light themes, wires, components, info modal)
  js/
    main.js        — init, controls, play/step/reset, pan/zoom, tab logic
    datapath.js    — SVG datapath builder + updateDatapath()
    cpu.js         — cycle-accurate RV32I simulator
    assembler.js   — RISC-V assembler (text → machine code)
```

---

## Component Layout (`C` object in datapath.js)

```javascript
const C = {
    NEXT_MUX : { x:  52, y: 355, w:  52, h: 185 },  // next-PC mux (trapezoid)
    PC       : { x: 180, y: 400, w: 120, h:  80 },
    PC4_ADD  : { x: 180, y: 200, w: 120, h:  70 },
    PC_TGT   : { x: 660, y:  72, w: 120, h:  70 },  // PC/rs1+imm adder
    MUX_TGT  : { x: 490, y:  80, w:  52, h: 120 },  // PC vs RS1 selector (JALR)
    IMEM     : { x: 380, y: 330, w: 165, h: 175 },
    FE       : { x: 625, y: 330, w: 150, h: 175 },  // field extractor
    IMM_GEN  : { x: 625, y: 580, w: 150, h:  90 },
    RF       : { x: 855, y: 240, w: 315, h: 490 },  // register file
    MUX_A    : { x:1250, y: 300, w:  52, h: 165 },  // ALU src A: rs1 vs PC
    MUX_B    : { x:1250, y: 500, w:  52, h: 165 },  // ALU src B: rs2 vs imm
    ALU      : { x:1382, y: 310, w: 165, h: 265 },
    BRANCH   : { x:1647, y: 148, w: 185, h: 170 },
    DMEM     : { x:1932, y: 265, w: 195, h: 330 },
    WB_MUX   : { x: 940, y: 828, w:  52, h: 180 },  // writeback mux (3-to-1)
    DECODER  : { x:  52, y:1060, w:2180, h: 105 },
};
```

---

## Wire Types & Colors

| Class | Color | Style | Use |
|---|---|---|---|
| `wire-data` | `#38bdf8` (blue) | solid 2px | 32-bit data paths |
| `wire-ctrl` | `#fb923c` (orange) | dashed 1.5px | Control signals from decoder |
| `wire-instr` | `#c084fc` (purple) | solid 2px, **inline style** | FE → Decoder instruction bus |
| `.inactive` suffix | dim/faded | — | Unused this cycle |

**Important:** `wire-instr` uses **inline `style="stroke:#c084fc"`** on the path element (not CSS class) because the CSS class wasn't applying reliably. See `wire-fe-dec` in `buildDatapath`.

Arrow markers in `index.html` `<defs>`: `arrow-data`, `arrow-ctrl`, `arrow-inactive`, `arrow-instr` (last one uses `fill="#c084fc"` as attribute, not CSS class).

---

## Wire Routing Corridors

```javascript
const leftOfPC4   = C.PC4_ADD.x - 15;        // 165
const topCorr     = C.PC_TGT.y - 18;          // 54  (branch→nextmux top corridor)
const altTopCorr  = C.PC_TGT.y - 30;          // 42
const leftOfIMM   = C.IMM_GEN.x - 15;         // 610
const rightOfFE   = C.FE.x + C.FE.w + 15;    // 790
const belowRF     = C.RF.y + C.RF.h + 15;     // 745
const belowMuxB   = C.MUX_B.y + C.MUX_B.h + 15;  // 680
const leftOfMuxAB = C.MUX_B.x - 18;           // 1232
const immMuxBCorr = C.MUX_B.x - 50;           // 1200 (separate from leftOfMuxAB)
const rightOfALU  = C.ALU.x + C.ALU.w + 20;  // 1567
const leftOfRF    = C.RF.x - 15;              // 840
const aluBrMid    = (C.ALU.x + C.ALU.w + C.BRANCH.x) >> 1;  // 1639 midpoint
const decY        = C.DECODER.y;              // 1060
```

---

## Key Wire Routing Notes

- **wire-fe-dec** (purple, FE→Decoder): Exits FE bottom at frac 0.25, stubs down to `belowMux` (NEXT_MUX bottom + 15 = 555), goes left to `outerX = DECODER.x - 20 = 32`, down to DECODER mid-height (y=1112), then **right** to DECODER.x=52 (arrow points rightward into decoder). Uses inline style.
- **wire-alu-dmem**: Uses `rightOfBranch = BRANCH.x + BRANCH.w + 15 = 1847` to avoid crossing BRANCH box.
- **wire-alu-wbmux**: Routes below WB_MUX (`belowWB = WB_MUX.y + h + 12 = 1020`), approaches from left (`leftCorr = WB_MUX.x - 15 = 925`).
- **wire-dmem-wbmux**: Different corridor from alu wire (`belowWB = 1030`, `leftCorr = 915`).
- **wire-pctgt-nextmux**: Exits PC_TGT TOP (frac 0.3), routes left via `tgtTopCorr = ty - 15`.
- **wire-immgen-muxb**: Uses `immMuxBCorr = 1200` (not `leftOfMuxAB = 1232`) to avoid orange/blue overlap.
- **wire-pc4-nextmux**: Exits PC4_ADD bottom at frac 0.3, uses `leftX = NEXT_MUX.x - 20 = 32`.
- **wire-pc4-wbmux**: Exits PC4_ADD bottom at frac 0.5, routes via `leftOfRF = 840`.
- **NEXT_MUX left corridors**: x=16 (ctrl/branch), x=24 (pctgt), x=32 (pc4) — three separate verticals.
- **Ctrl wires to Branch**: split into `wire-dec-branch` (frac 0.35) and `wire-dec-jump` (frac 0.65).
- **Ctrl wires to DMEM**: split into `wire-dec-dmem-we` (frac 0.35) and `wire-dec-dmem-re` (frac 0.65).
- **wire-dec-muxtgt**: Detours via `detourX = IMEM.x - 25 = 355`, `belowIMEM = IMEM.y + h + 15 = 520`.
- **DMEM output**: exits DMEM **right side** at frac 0.7 (was bottom — fixed).
- **WB_MUX inputs (alu, mem)**: approach from LEFT (routes below WB_MUX then comes back right) so arrow points rightward into inputs.

---

## Mux Input Labels (`muxLbl` helper)

All mux input labels use `muxLbl(g, x, y, text)` which draws a `rect.wire-label-bg` + `text` so the background obscures wires behind the label. Labels positioned at `MUX.y + MUX.h * frac - 10` (10px above wire entry point).

```javascript
// MUX_TGT: pc (frac 0.22), rs1 (frac 0.78)
// MUX_A:   rs1 (frac 0.22), pc (frac 0.78)
// MUX_B:   rs2 (frac 0.22), imm (frac 0.78)
// WB_MUX:  pc+4 (frac 0.18), alu (frac 0.5), mem (frac 0.82)
```

---

## Wire Value Labels

Floating labels on wires showing current cycle values. Created with `wireLabel(g, id, x, y)` — bg rect hidden until value set, text 14px above wire y. Updated in `updateDatapath`.

| Label ID | Signal | Position |
|---|---|---|
| `wl-pc` | pc | right of PC box |
| `wl-pcnext` | pc_next | right of NEXT_MUX (mid) |
| `wl-instr` | instruction word | right of IMEM |
| `wl-imm` | immediate | left of MUX_B bottom input |
| `wl-rs1d` | rs1_data | left of MUX_A top input |
| `wl-rs2d` | rs2_data | left of MUX_B top input |
| `wl-rs1-tgt` | rs1_data (to MUX_TGT) | between RF and MUX_TGT |
| `wl-wdata` | rs2_data (store data) | left of ALU, below MUX_B |
| `wl-alua` | alu_a | left of ALU top input |
| `wl-alub` | alu_b | left of ALU bottom input |
| `wl-alur` | alu_result | right of ALU |
| `wl-dmrd` | dmem_rdata | right of DMEM |
| `wl-wb` | wb_data | right of WB_MUX |
| `wl-pctgt` | pc_target | right of NEXT_MUX (bottom) |
| `wl-pc4` | pc_plus4 | right of NEXT_MUX (top) |

**Z-order fix** (end of `buildDatapath`):
```javascript
Array.from(g.querySelectorAll('text, rect.wire-label-bg'))
     .forEach(node => g.appendChild(node));
```

---

## `makeWire` and `setWire`

```javascript
function makeWire(id, d, cls = 'wire-data') {
    const markerMap = { 'wire-ctrl': 'ctrl', 'wire-instr': 'instr' };
    const marker = markerMap[cls] || 'data';
    return el('path', { id, d, class: cls, fill: 'none', 'marker-end': `url(#arrow-${marker})` });
}

function setWire(id, active, typeOrCtrl = false) {
    // typeOrCtrl: false = 'data', true = 'ctrl', 'instr' = instr
    const type = typeOrCtrl === true ? 'ctrl' : typeOrCtrl === false ? 'data' : typeOrCtrl;
    const base = `wire-${type}`;
    el.setAttribute('class', active ? base : `${base} inactive`);
    el.setAttribute('marker-end', `url(#arrow-${active ? type : 'inactive'})`);
}
```

---

## Info Modal (BROKEN — needs fix)

An ℹ button is in the toolbar (`#btn-info`). Clicking it should show `#info-overlay` (full-screen modal with About content). The modal HTML is in `index.html` below the program-ended modal. CSS is in `style.css` (`#info-overlay`, `#info-modal`, `.info-col`, etc.).

**Status: NOT WORKING.** The button click does nothing. Tried:
- `classList.remove('hidden')` approach
- Inline `onclick` on the button
- `style.display = 'flex'` approach
- Removing `#info-overlay.hidden` CSS rule

Root cause unknown — likely a CSS issue where `#info-overlay` itself isn't rendering even when `display:flex` is set, OR a stacking/z-index problem. **This needs to be debugged in the next session.**

The overlay HTML uses `style="display:none"` and the button has `onclick="document.getElementById('info-overlay').style.display='flex'"`.

Content of the modal: two-column layout with What is this, How to use, Wire legend, Why 0x80000000, RV32I formats (left col) + Component guide for all 14 blocks (right col).

---

## Default Display Mode

`fmt` defaults to `'hex'` in main.js (line ~71). PC values show as `0x80000000` not `-2147483648`.

---

## Mux Selector Display

Mux sel labels show `''` (empty) before program loads. After load: `'0→rs1'`, `'1→pc'` etc.

---

## Known Issues / TODO

1. **Info modal button not working** — highest priority for next session
2. Consider spreading component layout for less clutter (requires bumping all `C` coords)
