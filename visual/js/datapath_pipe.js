// datapath_pipe.js — builds the 5-stage pipeline SVG datapath diagram
// buildPipeDatapath(viewport) — called once on page load
// updatePipeDatapath(snap, fmt) — called every step with the cpu_pipe.js snapshot
//
// Pipeline registers are drawn as tall bars with stacked mini-rectangles (cells).
// Each cell is labeled (e.g. "PC", "Instruction") and wires connect to the
// left/right edge of the specific cell carrying that signal.

'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALU_NAMES = ['ADD','SUB','AND','OR','XOR','SLL','SRL','SRA','SLT','SLTU','PASS_B'];

// ══════════════════════════════════════════════════════════════════════════════
//  Stage columns
// ══════════════════════════════════════════════════════════════════════════════

const STAGE = {
    IF:    { x: 40,   w: 420 },
    IFID:  { x: 460,  w: 90  },
    ID:    { x: 550,  w: 500 },
    IDEX:  { x: 1050, w: 90  },
    EX:    { x: 1140, w: 1120 },  // wider to fit BRANCH/FWD_UNIT right of ALU
    EXMEM: { x: 2260, w: 90  },
    MEM:   { x: 2350, w: 420 },
    MEMWB: { x: 2770, w: 90  },
    WB:    { x: 2860, w: 380 },
};

const CANVAS_W = 3290;
const CANVAS_H = 1350;

const STAGE_LABEL_Y = 30;
const TOP_Y    = 60;
const BOTTOM_Y = 1200;
const PREG_Y   = TOP_Y;
const PREG_H   = BOTTOM_Y - TOP_Y;

// ── Component layout ─────────────────────────────────────────────────────────

const C = {
    // IF stage
    NEXT_MUX: { x: 55,  y: 440, w: 48, h: 160 },
    PC:       { x: 150, y: 480, w: 100, h: 70 },
    PC4_ADD:  { x: 280, y: 280, w: 100, h: 60 },
    IMEM:     { x: 280, y: 420, w: 110, h: 160 },

    // ID stage
    FE:       { x: 580, y: 250, w: 130, h: 160 },
    IMM_GEN:  { x: 580, y: 500, w: 130, h: 70 },
    DECODER:  { x: 580, y: 880, w: 130, h: 90 },
    RF:       { x: 780, y: 200, w: 200, h: 440 },

    // EX stage — matching reference diagram layout
    // Forwarding pick muxes → ALU input muxes → ALU, with FWD unit to right of ALU
    FWD_MUX_A: { x: 1280, y: 250, w: 48, h: 110 },
    FWD_MUX_B: { x: 1280, y: 560, w: 48, h: 110 },
    MUX_A:     { x: 1450, y: 250, w: 48, h: 110 },
    MUX_B:     { x: 1450, y: 560, w: 48, h: 110 },
    ALU:        { x: 1620, y: 310, w: 140, h: 250 },
    PC_IMM_ADD: { x: 1620, y: 110, w: 110, h: 60  },  // ADDER: PC + Imm
    EX_PC4_ADD: { x: 1620, y: 220, w: 110, h: 60  },  // ADDER: PC + 4
    BR_MUX:     { x: 1810, y: 110, w: 48,  h: 120 },  // Branch Mux: PC+Imm vs ALU (JALR)
    BRANCH:     { x: 1920, y: 110, w: 160, h: 145 },   // Branch Logic (right of BR_MUX)
    FWD_UNIT:   { x: 1920, y: 420, w: 160, h: 130 },
    HAZ_UNIT:  { x: 1300, y: 900, w: 170, h: 80 },

    // MEM stage
    DMEM:      { x: 2440, y: 280, w: 170, h: 300 },

    // WB stage
    WB_MUX:    { x: 2970, y: 340, w: 48, h: 160 },
};

// ══════════════════════════════════════════════════════════════════════════════
//  Pipeline register cell definitions
//  Each pipe reg is a tall bar divided into stacked cells.
//  Each cell has: id (for value updates), label (displayed text).
//  Wires connect to left/right edge of the cell by its id.
// ══════════════════════════════════════════════════════════════════════════════

const PREG_CELLS = {
    IFID: [
        { id: 'ifid-pc',    label: 'PC' },
        { id: 'ifid-instr', label: 'Instr' },
    ],
    IDEX: [
        { id: 'idex-pc',    label: 'PC'      },
        { id: 'idex-rs1d',  label: 'RS1 dat' },
        { id: 'idex-rs2d',  label: 'RS2 dat' },
        { id: 'idex-imm',   label: 'Imm'     },
        { id: 'idex-rs1a',  label: 'RS1 adr' },  // feeds forwarding unit
        { id: 'idex-rs2a',  label: 'RS2 adr' },  // feeds forwarding unit & hazard unit
        { id: 'idex-rd',    label: 'RD'      },
        { id: 'idex-f3',    label: 'Funct3'  },  // feeds branch logic
        { id: 'idex-ctrl',  label: 'Ctrl'    },
    ],
    EXMEM: [
        { id: 'exmem-alur', label: 'ALU Res' },
        { id: 'exmem-rs2d', label: 'RS2' },
        { id: 'exmem-pc4',  label: 'PC+4' },
        { id: 'exmem-rd',   label: 'RD' },
        { id: 'exmem-ctrl', label: 'Ctrl' },
    ],
    MEMWB: [
        { id: 'memwb-alur', label: 'ALU Res' },
        { id: 'memwb-memd', label: 'Mem Data' },
        { id: 'memwb-pc4',  label: 'PC+4' },
        { id: 'memwb-rd',   label: 'RD' },
        { id: 'memwb-ctrl', label: 'Ctrl' },
    ],
};

// Module-level map: cellId → { x, y, w, h, cx, cy } for wire routing
const cellPos = {};

// ── SVG helpers ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
}

function pt(comp, side, frac = 0.5) {
    const c = C[comp];
    switch (side) {
        case 'r': return [c.x + c.w,       c.y + c.h * frac];
        case 'l': return [c.x,              c.y + c.h * frac];
        case 't': return [c.x + c.w * frac, c.y];
        case 'b': return [c.x + c.w * frac, c.y + c.h];
    }
}

// Get left or right edge midpoint of a pipeline register cell
function cellPt(cellId, side) {
    const c = cellPos[cellId];
    if (!c) return [0, 0];
    return side === 'l' ? [c.x, c.cy] : [c.x + c.w, c.cy];
}

function wirePath([x1,y1], [x2,y2], midX) {
    const mx = midX !== undefined ? midX : (x1 + x2) / 2;
    if (Math.abs(y1 - y2) < 1) return `M ${x1},${y1} H ${x2}`;
    return `M ${x1},${y1} H ${mx} V ${y2} H ${x2}`;
}

function makeWire(id, d, cls = 'wire-data') {
    const markerMap = { 'wire-ctrl': 'ctrl', 'wire-instr': 'instr', 'wire-fwd': 'fwd' };
    const marker = markerMap[cls] || 'data';
    return el('path', { id, d, class: cls, fill: 'none', 'marker-end': `url(#arrow-${marker})` });
}

function txt(id, x, y, cls, content = '') {
    const t = el('text', { id, x, y, class: cls });
    t.textContent = content;
    return t;
}

function staticTxt(x, y, cls, content) {
    const t = el('text', { x, y, class: cls });
    t.textContent = content;
    return t;
}

function muxLbl(g, x, y, content) {
    const w = content.length * 6 + 6;
    const bg = el('rect', { x: x - 2, y: y - 12, width: w, height: 13,
                             class: 'wire-label-bg', rx: 2 });
    const t = el('text', { x, y: y - 2, class: 'sig-name' });
    t.textContent = content;
    g.appendChild(bg);
    g.appendChild(t);
}

function makeBox(g, comp, cls, title) {
    const { x, y, w, h } = C[comp];
    g.appendChild(el('rect', { x, y, width: w, height: h, class: `comp-box ${cls}`, rx: 6 }));
    if (title) {
        const t = staticTxt(x + 6, y + 13, 'comp-title', title);
        t.setAttribute('fill-opacity', '0.7');
        g.appendChild(t);
    }
}

function sigRow(g, x, y, label, valId, initVal = '—') {
    g.appendChild(staticTxt(x, y, 'sig-name', label));
    const v = txt(valId, x + 52, y, 'sig-value', initVal);
    g.appendChild(v);
    return v;
}

function makeMux(g, comp, cls, label) {
    const { x, y, w, h } = C[comp];
    const inset = h * 0.18;
    const pts = `${x},${y} ${x+w},${y+inset} ${x+w},${y+h-inset} ${x},${y+h}`;
    g.appendChild(el('polygon', { points: pts, class: `comp-box ${cls}` }));
    const t = staticTxt(x + 4, y + h / 2 + 4, 'mux-label', label);
    g.appendChild(t);
}

function wireLabel(g, id, x, y) {
    const bg = el('rect', { id: id + '-bg', x: x - 2, y: y - 16, width: 88, height: 13,
                             class: 'wire-label-bg', rx: 2, visibility: 'hidden' });
    const t  = txt(id, x, y - 5, 'wire-label', '');
    g.appendChild(bg);
    g.appendChild(t);
}

// ── Pipeline register bar with stacked cells ─────────────────────────────────

function makePipeRegCells(g, stageKey, title, cells) {
    const s = STAGE[stageKey];
    const pad = 4;           // padding inside the outer bar
    const titleH = 18;       // height reserved for the title at top
    const cellGap = 2;       // gap between cells
    const innerW = s.w - pad * 2;
    const innerTop = PREG_Y + pad + titleH;
    const innerH = PREG_H - pad * 2 - titleH;
    const totalGaps = (cells.length - 1) * cellGap;
    const cellH = (innerH - totalGaps) / cells.length;

    // Outer bar
    g.appendChild(el('rect', {
        id: `preg-${stageKey}`,
        x: s.x, y: PREG_Y, width: s.w, height: PREG_H,
        class: 'pipe-reg', rx: 4,
    }));

    // Title
    const titleT = staticTxt(s.x + s.w / 2, PREG_Y + pad + 12, 'pipe-reg-label', title);
    titleT.setAttribute('text-anchor', 'middle');
    g.appendChild(titleT);

    // Cells
    cells.forEach((cell, i) => {
        const cx = s.x + pad;
        const cy = innerTop + i * (cellH + cellGap);

        // Cell rectangle
        g.appendChild(el('rect', {
            id: `preg-cell-${cell.id}`,
            x: cx, y: cy, width: innerW, height: cellH,
            class: 'preg-cell', rx: 3,
        }));

        // Cell label (centered)
        const labelT = staticTxt(cx + innerW / 2, cy + cellH / 2 + 3, 'preg-cell-label', cell.label);
        labelT.setAttribute('text-anchor', 'middle');
        g.appendChild(labelT);

        // Value text (below label, shown on update)
        const valT = txt(`vp-${cell.id}`, cx + innerW / 2, cy + cellH / 2 + 14, 'preg-cell-value', '');
        valT.setAttribute('text-anchor', 'middle');
        g.appendChild(valT);

        // Store cell position for wire routing
        // x/w use the FULL stage x/w so wires connect at the outer edge of the bar
        cellPos[cell.id] = {
            x: s.x,
            y: cy,
            w: s.w,
            h: cellH,
            cx: s.x + s.w / 2,
            cy: cy + cellH / 2,
        };
    });
}

// ── Stage background + label ─────────────────────────────────────────────────

function stageBackground(g, stageKey, label) {
    const s = STAGE[stageKey];
    g.appendChild(el('rect', {
        x: s.x, y: TOP_Y, width: s.w, height: BOTTOM_Y - TOP_Y,
        class: 'stage-bg', rx: 0,
    }));
    const t = staticTxt(s.x + s.w / 2, STAGE_LABEL_Y, 'stage-label', label);
    t.setAttribute('text-anchor', 'middle');
    g.appendChild(t);
}

// ── Register file (compact 2-column) ─────────────────────────────────────────

function buildRegFile(g) {
    const { x, y, w, h } = C.RF;
    g.appendChild(el('rect', { x, y, width: w, height: h, class: 'regfile-wrap', rx: 6 }));
    g.appendChild(staticTxt(x + 6, y + 13, 'comp-title', 'Register File'));

    const rows   = 16;
    const colW   = (w - 20) / 2;
    const rowH   = (h - 28) / rows;
    const startY = y + 24;
    const col0X  = x + 6;
    const col1X  = x + 10 + colW;

    for (let i = 0; i < 32; i++) {
        const col = i < 16 ? 0 : 1;
        const row = i % 16;
        const cx  = col === 0 ? col0X : col1X;
        const ry  = startY + row * rowH;

        g.appendChild(staticTxt(cx, ry + rowH * 0.72, 'reg-name', `x${i}`));

        const bx = cx + 18;
        const bw = colW - 22;
        const bh = rowH - 3;
        g.appendChild(el('rect', { id: `reg-box-${i}`, x: bx, y: ry, width: bw, height: bh,
                                     class: 'reg-box', rx: 2 }));
        const vt = txt(`reg-val-${i}`, bx + bw / 2, ry + bh * 0.72, 'reg-value', '00000000');
        vt.setAttribute('text-anchor', 'middle');
        g.appendChild(vt);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  buildPipeDatapath
// ══════════════════════════════════════════════════════════════════════════════

export function buildPipeDatapath(viewport) {
    const g = viewport;

    // ── Stage backgrounds ────────────────────────────────────────────────
    stageBackground(g, 'IF',  'IF');
    stageBackground(g, 'ID',  'ID');
    stageBackground(g, 'EX',  'EX');
    stageBackground(g, 'MEM', 'MEM');
    stageBackground(g, 'WB',  'WB');

    // ── Pipeline register bars with cells ────────────────────────────────
    makePipeRegCells(g, 'IFID',  'IF/ID',  PREG_CELLS.IFID);
    makePipeRegCells(g, 'IDEX',  'ID/EX',  PREG_CELLS.IDEX);
    makePipeRegCells(g, 'EXMEM', 'EX/MEM', PREG_CELLS.EXMEM);
    makePipeRegCells(g, 'MEMWB', 'MEM/WB', PREG_CELLS.MEMWB);

    // ── IF stage components ──────────────────────────────────────────────
    makeMux(g, 'NEXT_MUX', 'comp-mux', 'MUX');
    g.appendChild(txt('vp-nextmux-sel', C.NEXT_MUX.x + 2, C.NEXT_MUX.y + C.NEXT_MUX.h + 12, 'sig-value', ''));
    muxLbl(g, C.NEXT_MUX.x - 28, C.NEXT_MUX.y + C.NEXT_MUX.h * 0.22 - 10, 'pc+4');
    muxLbl(g, C.NEXT_MUX.x - 24, C.NEXT_MUX.y + C.NEXT_MUX.h * 0.78 - 10, 'tgt');

    makeBox(g, 'PC', 'comp-pc', 'PC');
    sigRow(g, C.PC.x+6, C.PC.y+32, 'pc', 'vp-pc', '80000000');

    makeBox(g, 'PC4_ADD', 'comp-adder', 'PC+4');
    sigRow(g, C.PC4_ADD.x+6, C.PC4_ADD.y+32, '+4', 'vp-pc4', '—');

    makeBox(g, 'IMEM', 'comp-imem', 'IMEM');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+32, 'addr', 'vp-imem-addr', '—');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+50, 'instr','vp-instr', '—');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+68, 'asm',  'vp-asm', '—');

    // ── ID stage components ──────────────────────────────────────────────
    makeBox(g, 'FE', 'comp-fe', 'Field Extractor');
    sigRow(g, C.FE.x+6, C.FE.y+32, 'op',  'vp-opcode', '—');
    sigRow(g, C.FE.x+6, C.FE.y+48, 'rd',  'vp-rd', '—');
    sigRow(g, C.FE.x+6, C.FE.y+64, 'rs1', 'vp-rs1', '—');
    sigRow(g, C.FE.x+6, C.FE.y+80, 'rs2', 'vp-rs2', '—');
    sigRow(g, C.FE.x+6, C.FE.y+96, 'f3',  'vp-f3', '—');
    sigRow(g, C.FE.x+6, C.FE.y+112,'f7',  'vp-f7', '—');

    makeBox(g, 'IMM_GEN', 'comp-immgen', 'Imm Gen');
    sigRow(g, C.IMM_GEN.x+6, C.IMM_GEN.y+34, 'imm', 'vp-imm', '—');

    makeBox(g, 'DECODER', 'comp-decode', 'Decoder');
    sigRow(g, C.DECODER.x+6, C.DECODER.y+32, 'ctrl', 'vp-dec-ctrl', '—');
    sigRow(g, C.DECODER.x+6, C.DECODER.y+50, 'aluOp','vp-dec-aluop', '—');

    buildRegFile(g);

    // ── EX stage components ──────────────────────────────────────────────
    makeMux(g, 'FWD_MUX_A', 'comp-mux-fwd', 'FA');
    g.appendChild(txt('vp-fwda-sel', C.FWD_MUX_A.x + 2, C.FWD_MUX_A.y - 8, 'sig-value', ''));
    muxLbl(g, C.FWD_MUX_A.x - 28, C.FWD_MUX_A.y + C.FWD_MUX_A.h * 0.18 - 10, 'reg');
    muxLbl(g, C.FWD_MUX_A.x - 38, C.FWD_MUX_A.y + C.FWD_MUX_A.h * 0.50 - 10, 'exmem');
    muxLbl(g, C.FWD_MUX_A.x - 42, C.FWD_MUX_A.y + C.FWD_MUX_A.h * 0.82 - 10, 'memwb');

    makeMux(g, 'FWD_MUX_B', 'comp-mux-fwd', 'FB');
    g.appendChild(txt('vp-fwdb-sel', C.FWD_MUX_B.x + 2, C.FWD_MUX_B.y - 8, 'sig-value', ''));
    muxLbl(g, C.FWD_MUX_B.x - 28, C.FWD_MUX_B.y + C.FWD_MUX_B.h * 0.18 - 10, 'reg');
    muxLbl(g, C.FWD_MUX_B.x - 38, C.FWD_MUX_B.y + C.FWD_MUX_B.h * 0.50 - 10, 'exmem');
    muxLbl(g, C.FWD_MUX_B.x - 42, C.FWD_MUX_B.y + C.FWD_MUX_B.h * 0.82 - 10, 'memwb');

    makeMux(g, 'MUX_A', 'comp-mux', 'A');
    g.appendChild(txt('vp-muxa-sel', C.MUX_A.x + 2, C.MUX_A.y - 8, 'sig-value', ''));
    muxLbl(g, C.MUX_A.x - 28, C.MUX_A.y + C.MUX_A.h * 0.22 - 10, 'rs1');
    muxLbl(g, C.MUX_A.x - 24, C.MUX_A.y + C.MUX_A.h * 0.78 - 10, 'pc');

    makeMux(g, 'MUX_B', 'comp-mux', 'B');
    g.appendChild(txt('vp-muxb-sel', C.MUX_B.x + 2, C.MUX_B.y - 8, 'sig-value', ''));
    muxLbl(g, C.MUX_B.x - 28, C.MUX_B.y + C.MUX_B.h * 0.22 - 10, 'rs2');
    muxLbl(g, C.MUX_B.x - 24, C.MUX_B.y + C.MUX_B.h * 0.78 - 10, 'imm');

    makeBox(g, 'ALU', 'comp-alu', 'ALU');
    sigRow(g, C.ALU.x+6, C.ALU.y+32, 'A',   'vp-alua', '—');
    sigRow(g, C.ALU.x+6, C.ALU.y+50, 'B',   'vp-alub', '—');
    sigRow(g, C.ALU.x+6, C.ALU.y+68, 'op',  'vp-aluop', '—');
    g.appendChild(el('line', { x1: C.ALU.x+6, y1: C.ALU.y+78, x2: C.ALU.x+C.ALU.w-6, y2: C.ALU.y+78,
                                stroke: 'var(--border)', 'stroke-width': 1 }));
    sigRow(g, C.ALU.x+6, C.ALU.y+96, 'res', 'vp-alur', '—');

    // PC+Imm adder (branch/JAL target computation)
    makeBox(g, 'PC_IMM_ADD', 'comp-adder', 'ADDER');
    sigRow(g, C.PC_IMM_ADD.x+6, C.PC_IMM_ADD.y+32, 'PC+I', 'vp-pcimm', '—');

    // PC+4 adder in EX (link address for JAL/JALR writeback)
    makeBox(g, 'EX_PC4_ADD', 'comp-adder', 'ADDER');
    sigRow(g, C.EX_PC4_ADD.x+6, C.EX_PC4_ADD.y+32, '+4', 'vp-expc4', '—');

    // Branch Mux: selects PC+Imm (top, 0) or ALU/Rs1+Imm (bottom, 1) via PC_or_Rs1_mux
    makeMux(g, 'BR_MUX', 'comp-mux', 'MUX');
    muxLbl(g, C.BR_MUX.x - 36, C.BR_MUX.y + C.BR_MUX.h * 0.22 - 10, 'PC+I');
    muxLbl(g, C.BR_MUX.x - 36, C.BR_MUX.y + C.BR_MUX.h * 0.78 - 10, 'Rs1+I');
    g.appendChild(txt('vp-pctgt', C.BR_MUX.x + C.BR_MUX.w + 8, C.BR_MUX.y + C.BR_MUX.h / 2 + 4, 'sig-value', '—'));

    // Branch Logic
    makeBox(g, 'BRANCH', 'comp-branch', 'Branch Logic');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+32, 'br',   'vp-bl-br',  '—');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+50, 'jmp',  'vp-bl-jmp', '—');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+68, 'f3',   'vp-bl-f3',  '—');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+86, 'src',  'vp-pcsrc',  '—');

    makeBox(g, 'FWD_UNIT', 'comp-fwd', 'Forwarding Unit');
    sigRow(g, C.FWD_UNIT.x+6, C.FWD_UNIT.y+32, 'fA', 'vp-fwd-a', '00');
    sigRow(g, C.FWD_UNIT.x+6, C.FWD_UNIT.y+50, 'fB', 'vp-fwd-b', '00');

    makeBox(g, 'HAZ_UNIT', 'comp-hazard', 'Hazard Unit');
    sigRow(g, C.HAZ_UNIT.x+6, C.HAZ_UNIT.y+32, 'stall', 'vp-stall', '0');

    // ── MEM stage components ─────────────────────────────────────────────
    makeBox(g, 'DMEM', 'comp-dmem', 'Data Memory');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+32,  'addr',  'vp-dmem-addr', '—');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+50,  'wdata', 'vp-dmem-wdata','—');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+68,  'we',    'vp-dmem-we', '0');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+86,  're',    'vp-dmem-re', '0');
    g.appendChild(el('line', { x1: C.DMEM.x+6, y1: C.DMEM.y+96, x2: C.DMEM.x+C.DMEM.w-6, y2: C.DMEM.y+96,
                                stroke: 'var(--border)', 'stroke-width': 1 }));
    sigRow(g, C.DMEM.x+6, C.DMEM.y+114, 'rdata', 'vp-dmrd', '—');

    // ── WB stage components ──────────────────────────────────────────────
    makeMux(g, 'WB_MUX', 'comp-mux', 'WB');
    g.appendChild(txt('vp-wbmux-sel', C.WB_MUX.x + 2, C.WB_MUX.y - 8, 'sig-value', ''));
    muxLbl(g, C.WB_MUX.x - 36, C.WB_MUX.y + C.WB_MUX.h * 0.18 - 10, 'pc+4');
    muxLbl(g, C.WB_MUX.x - 28, C.WB_MUX.y + C.WB_MUX.h * 0.50 - 10, 'alu');
    muxLbl(g, C.WB_MUX.x - 28, C.WB_MUX.y + C.WB_MUX.h * 0.82 - 10, 'mem');

    // ══════════════════════════════════════════════════════════════════════
    //  WIRES — use cellPt() for pipe reg connections
    // ══════════════════════════════════════════════════════════════════════

    const topCorr    = TOP_Y + 10;
    const bottomCorr = BOTTOM_Y - 10;
    const wbBackY    = BOTTOM_Y - 30;

    // Helper: right edge of a pipe reg stage
    const pregR = key => STAGE[key].x + STAGE[key].w;
    const pregL = key => STAGE[key].x;

    // ── IF Stage wires ───────────────────────────────────────────────────

    // MUX → PC (single input on left)
    g.appendChild(makeWire('wp-nextmux-pc',
        wirePath(pt('NEXT_MUX','r'), pt('PC','l'))));

    // PC output goes right to a fan-out point, then splits to PC+4, IMEM, and IF/ID.
    // We draw three separate wires from the fan-out column.
    {
        const [px, py] = pt('PC', 'r');
        const fanX = C.PC.x + C.PC.w + 20;  // vertical bus line right of PC

        // PC → IMEM (horizontal from fan-out to IMEM left)
        const [ix, iy] = pt('IMEM', 'l');
        g.appendChild(makeWire('wp-pc-imem',
            `M ${px},${py} H ${fanX} V ${iy} H ${ix}`));

        // PC → PC+4 Adder (up from fan-out to adder left)
        const [ax, ay] = pt('PC4_ADD', 'l');
        g.appendChild(makeWire('wp-pc-pc4',
            `M ${fanX},${py} V ${ay} H ${ax}`));

        // PC → IF/ID PC cell (from fan-out, right past IMEM to IF/ID)
        const [cx, cy] = cellPt('ifid-pc', 'l');
        const pastImemX = C.IMEM.x + C.IMEM.w + 15;
        g.appendChild(makeWire('wp-pc-ifid',
            `M ${fanX},${py} V ${C.IMEM.y - 15} H ${pastImemX} V ${cy} H ${cx}`));
    }

    // PC+4 Adder output → MUX (exit right, loop up and around to mux top input)
    {
        const [rx, ry] = pt('PC4_ADD', 'r');
        const [mx, my] = pt('NEXT_MUX', 'l', 0.22);
        const rightX = C.IMEM.x + C.IMEM.w + 30;  // go right past IMEM
        const topY = C.PC4_ADD.y - 30;             // above adder
        const leftX = C.NEXT_MUX.x - 30;           // left of mux
        g.appendChild(makeWire('wp-pc4-nextmux',
            `M ${rx},${ry} H ${rightX} V ${topY} H ${leftX} V ${my} H ${mx}`));
    }

    // IMEM → IF/ID Instr cell
    {
        const [ix, iy] = pt('IMEM', 'r');
        const [cx, cy] = cellPt('ifid-instr', 'l');
        g.appendChild(makeWire('wp-imem-ifid',
            `M ${ix},${iy} H ${ix + 10} V ${cy} H ${cx}`));
    }

    // ── IF/ID → ID stage wires ───────────────────────────────────────────

    // IF/ID PC cell → (used by ID stage, passes through)
    // IF/ID Instr cell → FE
    {
        const [cx, cy] = cellPt('ifid-instr', 'r');
        const [fx, fy] = pt('FE', 'l', 0.4);
        g.appendChild(makeWire('wp-ifid-fe',
            `M ${cx},${cy} H ${cx + 10} V ${fy} H ${fx}`));
    }

    // IF/ID Instr → Imm Gen
    {
        const [cx, cy] = cellPt('ifid-instr', 'r');
        const [ix, iy] = pt('IMM_GEN', 'l');
        g.appendChild(makeWire('wp-ifid-immgen',
            `M ${cx},${cy} H ${cx + 15} V ${iy} H ${ix}`));
    }

    // FE → RF
    g.appendChild(makeWire('wp-fe-rf',
        wirePath(pt('FE','r', 0.4), pt('RF','l', 0.3))));

    // FE → Decoder (instruction bus) — route left of Imm Gen
    {
        const [fx, fy] = pt('FE', 'b', 0.2);
        const [dx, dy] = pt('DECODER', 't', 0.3);
        const leftOfImm = C.IMM_GEN.x - 15;
        g.appendChild(makeWire('wp-fe-dec',
            `M ${fx},${fy} V ${fy + 10} H ${leftOfImm} V ${dy - 10} H ${dx} V ${dy}`, 'wire-instr'));
    }

    // RF rs1_data → ID/EX RS1 cell
    {
        const [rx, ry] = pt('RF', 'r', 0.35);
        const [cx, cy] = cellPt('idex-rs1d', 'l');
        g.appendChild(makeWire('wp-rf-idex-rs1',
            `M ${rx},${ry} H ${rx + 10} V ${cy} H ${cx}`));
    }

    // RF rs2_data → ID/EX RS2 cell
    {
        const [rx, ry] = pt('RF', 'r', 0.55);
        const [cx, cy] = cellPt('idex-rs2d', 'l');
        g.appendChild(makeWire('wp-rf-idex-rs2',
            `M ${rx},${ry} H ${rx + 15} V ${cy} H ${cx}`));
    }

    // Imm Gen → ID/EX Imm cell — route below RF to avoid cutting through it
    {
        const [ix, iy] = pt('IMM_GEN', 'r');
        const [cx, cy] = cellPt('idex-imm', 'l');
        const belowRF = C.RF.y + C.RF.h + 15;
        const rightOfRF = C.RF.x + C.RF.w + 20;
        g.appendChild(makeWire('wp-immgen-idex',
            `M ${ix},${iy} H ${ix + 10} V ${belowRF} H ${rightOfRF} V ${cy} H ${cx}`));
    }

    // Decoder → ID/EX Ctrl cell (dashed) — route right of RF
    {
        const [dx, dy] = pt('DECODER', 'r');
        const [cx, cy] = cellPt('idex-ctrl', 'l');
        const rightOfRF = C.RF.x + C.RF.w + 30;
        g.appendChild(makeWire('wp-dec-idex',
            `M ${dx},${dy} H ${rightOfRF} V ${cy} H ${cx}`, 'wire-ctrl'));
    }

    // IF/ID PC → ID/EX PC cell (pass through — route above FE and RF)
    {
        const [px, py] = cellPt('ifid-pc', 'r');
        const [cx, cy] = cellPt('idex-pc', 'l');
        const aboveAll = C.RF.y - 20;  // above RF top
        const rightOfRF = C.RF.x + C.RF.w + 15;
        g.appendChild(makeWire('wp-ifid-idex-pc',
            `M ${px},${py} H ${px + 10} V ${aboveAll} H ${rightOfRF} V ${cy} H ${cx}`));
    }

    // FE rd → ID/EX RD cell — route below RF to avoid cutting through it
    {
        const [fx, fy] = pt('FE', 'r', 0.7);
        const [cx, cy] = cellPt('idex-rd', 'l');
        const belowRF = C.RF.y + C.RF.h + 30;
        const rightOfRF = C.RF.x + C.RF.w + 25;
        g.appendChild(makeWire('wp-fe-idex-rd',
            `M ${fx},${fy} H ${fx + 5} V ${belowRF} H ${rightOfRF} V ${cy} H ${cx}`));
    }

    // ── ID/EX → EX stage wires ───────────────────────────────────────────
    //
    // Corridor definitions for clean routing:
    //   fwdRailX  = vertical rail far left of FA/FB for forwarding data (110px clear)
    //   gapY      = y range between FA (bottom=360) and FB (top=560)
    //   belowAllY = y below FB and all muxes for bottom corridor
    //
    const fwdRailX  = C.FWD_MUX_A.x - 100; // ~1180 — far left, clear of labels
    const gapTopY   = C.FWD_MUX_A.y + C.FWD_MUX_A.h; // FA bottom = 360
    const gapBotY   = C.FWD_MUX_B.y;                  // FB top = 560
    const belowAllY = C.FWD_MUX_B.y + C.FWD_MUX_B.h + 50; // ~720
    const betweenFwdMux = (C.FWD_MUX_A.x + C.FWD_MUX_A.w + C.MUX_A.x) / 2; // midpoint between FA/FB and A/B

    // ID/EX RS1 cell → FWD_MUX_A (top input — direct horizontal)
    {
        const [cx, cy] = cellPt('idex-rs1d', 'r');
        const [mx, my] = pt('FWD_MUX_A', 'l', 0.18);
        g.appendChild(makeWire('wp-idex-fwda',
            `M ${cx},${cy} H ${cx + 15} V ${my} H ${mx}`));
    }

    // ID/EX RS2 cell → FWD_MUX_B (top input — direct horizontal)
    {
        const [cx, cy] = cellPt('idex-rs2d', 'r');
        const [mx, my] = pt('FWD_MUX_B', 'l', 0.18);
        g.appendChild(makeWire('wp-idex-fwdb',
            `M ${cx},${cy} H ${cx + 15} V ${my} H ${mx}`));
    }

    // FWD_MUX_A → MUX_A (horizontal through gap area)
    g.appendChild(makeWire('wp-fwda-muxa',
        wirePath(pt('FWD_MUX_A','r'), pt('MUX_A','l', 0.22))));

    // FWD_MUX_B → MUX_B (horizontal)
    g.appendChild(makeWire('wp-fwdb-muxb',
        wirePath(pt('FWD_MUX_B','r'), pt('MUX_B','l', 0.22))));

    // ID/EX PC cell → MUX_A bottom input (AUIPC)
    // Route through gap between FA and MUX_A — go right of FA, then up
    {
        const [cx, cy] = cellPt('idex-pc', 'r');
        const [mx, my] = pt('MUX_A', 'l', 0.78);
        const gapMidY = (gapTopY + gapBotY) / 2;
        g.appendChild(makeWire('wp-idex-muxa-pc',
            `M ${cx},${cy} H ${cx + 20} V ${gapMidY} H ${betweenFwdMux} V ${my} H ${mx}`));
    }

    // ID/EX Imm cell → MUX_B bottom input
    // Route below FB, then right of FB, then up
    {
        const [cx, cy] = cellPt('idex-imm', 'r');
        const [mx, my] = pt('MUX_B', 'l', 0.78);
        g.appendChild(makeWire('wp-idex-muxb-imm',
            `M ${cx},${cy} H ${cx + 20} V ${belowAllY - 15} H ${betweenFwdMux} V ${my} H ${mx}`));
    }

    // MUX_A → ALU
    g.appendChild(makeWire('wp-muxa-alu',
        wirePath(pt('MUX_A','r'), pt('ALU','l', 0.25))));

    // MUX_B → ALU
    g.appendChild(makeWire('wp-muxb-alu',
        wirePath(pt('MUX_B','r'), pt('ALU','l', 0.75))));

    // ── EX upper area: Adders, Branch Mux, Branch Logic ────────────────────
    //
    // From reference diagram & RTL:
    //   PC_IMM_ADD: idex_pc + idex_imm → pc_plus_imm (branch/JAL target)
    //   EX_PC4_ADD: idex_pc + 4 → pc_plus4 (link address for JAL/JALR)
    //   BR_MUX:     pc_plus_imm (0) | alu_result (1) → branch_target (sel = PC_or_Rs1_mux)
    //   BRANCH:     alu_result + funct3 + branch + jump → pc_src
    //
    const rightOfBranch = C.BRANCH.x + C.BRANCH.w + 15;  // for wire routing
    const rightOfMuxA   = C.MUX_A.x + C.MUX_A.w + 20;   // for top-corridor routing
    const aboveAll      = C.FWD_MUX_A.y - 30;            // y for top-corridor

    // ID/EX PC → PC_IMM_ADD left (top input)
    {
        const [cx, cy] = cellPt('idex-pc', 'r');
        const [ax, ay] = pt('PC_IMM_ADD', 'l', 0.3);
        g.appendChild(makeWire('wp-idex-pcimm-pc',
            `M ${cx},${cy} H ${cx + 25} V ${ay} H ${ax}`));
    }

    // ID/EX Imm → PC_IMM_ADD left (bottom input)
    {
        const [cx, cy] = cellPt('idex-imm', 'r');
        const [ax, ay] = pt('PC_IMM_ADD', 'l', 0.7);
        const belowAdder = C.PC_IMM_ADD.y + C.PC_IMM_ADD.h + 10;
        g.appendChild(makeWire('wp-idex-pcimm-imm',
            `M ${cx},${cy} H ${cx + 30} V ${belowAdder} H ${C.PC_IMM_ADD.x - 15} V ${ay} H ${ax}`));
    }

    // PC_IMM_ADD → BR_MUX top input (PC+Imm)
    {
        const [ax, ay] = pt('PC_IMM_ADD', 'r');
        const [mx, my] = pt('BR_MUX', 'l', 0.22);
        g.appendChild(makeWire('wp-pcimm-brmux',
            `M ${ax},${ay} H ${ax + 10} V ${my} H ${mx}`));
    }

    // ALU result → BR_MUX bottom input (Rs1+Imm, for JALR)
    // Route: ALU right side → right past adders → up to BR_MUX left at 0.78
    {
        const [ax, ay] = pt('ALU', 'r', 0.05);
        const [mx, my] = pt('BR_MUX', 'l', 0.78);
        const gapX2 = C.ALU.x + C.ALU.w + 25; // 1785, between adders (end 1730) and BR_MUX (start 1810)
        g.appendChild(makeWire('wp-alu-brmux',
            `M ${ax},${ay} H ${gapX2} V ${my} H ${mx}`));
    }

    // BR_MUX output → NEXT_MUX (branch target back to IF via top corridor)
    {
        const [mx, my] = pt('BR_MUX', 'r');
        const [nx, ny] = pt('NEXT_MUX', 'l', 0.78);
        const leftCorr = C.NEXT_MUX.x - 40;
        g.appendChild(makeWire('wp-brmux-nextmux',
            `M ${mx},${my} H ${mx + 10} V ${topCorr} H ${leftCorr} V ${ny} H ${nx}`));
    }

    // ALU → Branch Logic (alu_result for branch comparison)
    // Route: ALU right → right past adders → up to below BR_MUX → right to BRANCH left
    {
        const [ax, ay] = pt('ALU', 'r', 0.15);
        const [bx, by] = pt('BRANCH', 'l', 0.9); // enter below BR_MUX bottom (y=230)
        const gapX = C.ALU.x + C.ALU.w + 15;
        g.appendChild(makeWire('wp-alu-branch',
            `M ${ax},${ay} H ${gapX} V ${by} H ${bx}`));
    }

    // ALU → EX/MEM ALU Res cell — route ABOVE FWD_UNIT
    {
        const [ax, ay] = pt('ALU', 'r', 0.5);
        const [cx, cy] = cellPt('exmem-alur', 'l');
        const aluFwdGapX = C.ALU.x + C.ALU.w + 10;
        const aboveFwd   = C.FWD_UNIT.y - 15;
        const rightOfAll = Math.max(C.BRANCH.x + C.BRANCH.w, C.FWD_UNIT.x + C.FWD_UNIT.w) + 15;
        g.appendChild(makeWire('wp-alu-exmem',
            `M ${ax},${ay} H ${aluFwdGapX} V ${aboveFwd} H ${rightOfAll} V ${cy} H ${cx}`));
    }

    // ID/EX PC → EX_PC4_ADD left (PC input for +4 adder)
    {
        const [cx, cy] = cellPt('idex-pc', 'r');
        const [ax, ay] = pt('EX_PC4_ADD', 'l', 0.5);
        g.appendChild(makeWire('wp-idex-expc4',
            `M ${cx},${cy} H ${cx + 20} V ${ay} H ${ax}`));
    }

    // EX_PC4_ADD → EX/MEM PC+4 cell
    // Route below ALU via bottom corridor
    {
        const [ax, ay] = pt('EX_PC4_ADD', 'r');
        const [cx, cy] = cellPt('exmem-pc4', 'l');
        const routeY = belowAllY + 55;
        g.appendChild(makeWire('wp-expc4-exmem',
            `M ${ax},${ay} H ${ax + 10} V ${routeY} H ${cx - 10} V ${cy} H ${cx}`));
    }

    // Branch pc_src → NEXT_MUX (ctrl — via top corridor)
    {
        const [bx, by] = pt('BRANCH', 't', 0.5);
        const [mx, my] = pt('NEXT_MUX', 'b', 0.5);
        const ctrlCorr = topCorr - 12;
        const leftCorr = C.NEXT_MUX.x - 50;
        g.appendChild(makeWire('wp-branch-nextmux',
            `M ${bx},${by} V ${ctrlCorr} H ${leftCorr} V ${my + 15} H ${mx} V ${my}`, 'wire-ctrl'));
    }

    // ID/EX Ctrl → Branch Logic (branch/jump ctrl — route above everything)
    {
        const [cx, cy] = cellPt('idex-ctrl', 'r');
        const [bx, by] = pt('BRANCH', 'b', 0.5);
        g.appendChild(makeWire('wp-idex-branch',
            `M ${cx},${cy} H ${cx + 10} V ${aboveAll} H ${rightOfMuxA} V ${by + 25} H ${bx} V ${by}`, 'wire-ctrl'));
    }

    // ── EX ctrl wires ───────────────────────────────────────────────────────

    // ID/EX Ctrl → ALU bottom (alu_op select)
    {
        const [cx, cy] = cellPt('idex-ctrl', 'r');
        const aluBotX = C.ALU.x + C.ALU.w * 0.5;
        const aluBotY = C.ALU.y + C.ALU.h;
        g.appendChild(makeWire('wp-idex-alu-ctrl',
            `M ${cx},${cy} H ${aluBotX} V ${aluBotY}`, 'wire-ctrl'));
    }

    // ID/EX Funct3 → BRANCH left (funct3 input — route above BR_MUX, offset left of BRANCH)
    {
        const [cx, cy] = cellPt('idex-f3', 'r');
        const [bx, by] = pt('BRANCH', 'l', 0.6);
        const aboveBrmux = C.BR_MUX.y - 15; // y=95, above BR_MUX top (110)
        const leftOfBranch = C.BRANCH.x - 15; // stay 15px left of BRANCH edge
        g.appendChild(makeWire('wp-idex-branch-f3',
            `M ${cx},${cy} H ${cx + 15} V ${aboveAll} H ${rightOfMuxA} V ${aboveBrmux} H ${leftOfBranch} V ${by} H ${bx}`, 'wire-ctrl'));
    }

    // ID/EX Ctrl → BR_MUX bottom (PC_or_Rs1_mux select for JALR)
    // Route: right from ctrl cell → up to bottom corridor → right to below BR_MUX → up into bottom face
    {
        const [cx, cy] = cellPt('idex-ctrl', 'r');
        const brMuxBotX = C.BR_MUX.x + C.BR_MUX.w / 2;
        const brMuxBotY = C.BR_MUX.y + C.BR_MUX.h;
        const routeY = belowAllY + 25; // bottom corridor, clear of all EX components
        g.appendChild(makeWire('wp-idex-brmux-ctrl',
            `M ${cx},${cy} H ${cx + 5} V ${routeY} H ${brMuxBotX} V ${brMuxBotY}`, 'wire-ctrl'));
    }

    // rs2 data through EX → EX/MEM RS2 cell (for stores)
    // Route via bottom corridor to stay clear of ALU and FWD_UNIT
    {
        const [fwdbRx, fwdbRy] = pt('FWD_MUX_B', 'r');
        const [cx, cy] = cellPt('exmem-rs2d', 'l');
        const rightOfFwdUnit = C.FWD_UNIT.x + C.FWD_UNIT.w + 15; // right of FWD_UNIT
        g.appendChild(makeWire('wp-rs2-exmem',
            `M ${fwdbRx},${fwdbRy} H ${fwdbRx + 15} V ${belowAllY + 5} H ${rightOfFwdUnit} V ${cy} H ${cx}`));
    }

    // (PC+4 path now handled by EX_PC4_ADD → wp-expc4-exmem above)

    // ── EX/MEM → MEM stage wires ─────────────────────────────────────────

    // EX/MEM ALU Res cell → DMEM (address)
    {
        const [cx, cy] = cellPt('exmem-alur', 'r');
        const [dx, dy] = [C.DMEM.x, C.DMEM.y + 32];
        g.appendChild(makeWire('wp-exmem-dmem-addr',
            `M ${cx},${cy} H ${cx + 10} V ${dy} H ${dx}`));
    }

    // EX/MEM RS2 cell → DMEM (write data)
    {
        const [cx, cy] = cellPt('exmem-rs2d', 'r');
        const [dx, dy] = [C.DMEM.x, C.DMEM.y + 52];
        g.appendChild(makeWire('wp-exmem-dmem-wdata',
            `M ${cx},${cy} H ${cx + 15} V ${dy} H ${dx}`));
    }

    // EX/MEM Ctrl cell → DMEM (we/re ctrl)
    {
        const [cx, cy] = cellPt('exmem-ctrl', 'r');
        const [dx, dy] = [C.DMEM.x, C.DMEM.y + C.DMEM.h - 20];
        g.appendChild(makeWire('wp-exmem-dmem-ctrl',
            `M ${cx},${cy} H ${cx + 10} V ${dy} H ${dx}`, 'wire-ctrl'));
    }

    // DMEM → MEM/WB Mem Data cell
    {
        const [dx, dy] = [C.DMEM.x + C.DMEM.w, C.DMEM.y + 114];
        const [cx, cy] = cellPt('memwb-memd', 'l');
        g.appendChild(makeWire('wp-dmem-memwb',
            `M ${dx},${dy} H ${dx + 10} V ${cy} H ${cx}`));
    }

    // EX/MEM ALU Res → MEM/WB ALU Res cell (pass-through above DMEM)
    {
        const [cx1, cy1] = cellPt('exmem-alur', 'r');
        const [cx2, cy2] = cellPt('memwb-alur', 'l');
        const passY = C.DMEM.y - 20;
        g.appendChild(makeWire('wp-exmem-memwb-alu',
            `M ${cx1},${cy1} H ${cx1 + 5} V ${passY} H ${cx2 - 5} V ${cy2} H ${cx2}`));
    }

    // EX/MEM PC+4 → MEM/WB PC+4 cell (pass-through below DMEM)
    {
        const [cx1, cy1] = cellPt('exmem-pc4', 'r');
        const [cx2, cy2] = cellPt('memwb-pc4', 'l');
        const passY = C.DMEM.y + C.DMEM.h + 30;
        g.appendChild(makeWire('wp-exmem-memwb-pc4',
            `M ${cx1},${cy1} H ${cx1 + 5} V ${passY} H ${cx2 - 5} V ${cy2} H ${cx2}`));
    }

    // EX/MEM RD → MEM/WB RD (pass-through)
    {
        const [cx1, cy1] = cellPt('exmem-rd', 'r');
        const [cx2, cy2] = cellPt('memwb-rd', 'l');
        const passY = C.DMEM.y + C.DMEM.h + 50;
        g.appendChild(makeWire('wp-exmem-memwb-rd',
            `M ${cx1},${cy1} H ${cx1 + 5} V ${passY} H ${cx2 - 5} V ${cy2} H ${cx2}`));
    }

    // EX/MEM Ctrl → MEM/WB Ctrl (pass-through)
    {
        const [cx1, cy1] = cellPt('exmem-ctrl', 'r');
        const [cx2, cy2] = cellPt('memwb-ctrl', 'l');
        const passY = C.DMEM.y + C.DMEM.h + 65;
        g.appendChild(makeWire('wp-exmem-memwb-ctrl',
            `M ${cx1},${cy1} H ${cx1 + 5} V ${passY} H ${cx2 - 5} V ${cy2} H ${cx2}`, 'wire-ctrl'));
    }

    // ── MEM/WB → WB stage wires ──────────────────────────────────────────

    // MEM/WB PC+4 cell → WB_MUX top
    {
        const [cx, cy] = cellPt('memwb-pc4', 'r');
        const [mx, my] = pt('WB_MUX', 'l', 0.18);
        g.appendChild(makeWire('wp-memwb-wbmux-pc4',
            `M ${cx},${cy} H ${cx + 10} V ${my} H ${mx}`));
    }

    // MEM/WB ALU Res cell → WB_MUX mid
    {
        const [cx, cy] = cellPt('memwb-alur', 'r');
        const [mx, my] = pt('WB_MUX', 'l', 0.50);
        g.appendChild(makeWire('wp-memwb-wbmux-alu',
            `M ${cx},${cy} H ${cx + 15} V ${my} H ${mx}`));
    }

    // MEM/WB Mem Data cell → WB_MUX bottom
    {
        const [cx, cy] = cellPt('memwb-memd', 'r');
        const [mx, my] = pt('WB_MUX', 'l', 0.82);
        g.appendChild(makeWire('wp-memwb-wbmux-mem',
            `M ${cx},${cy} H ${cx + 10} V ${my} H ${mx}`));
    }

    // ── WB → RF writeback (long wire below all stages) ───────────────────
    // WB data enters RF from the LEFT side
    {
        const [wx, wy] = pt('WB_MUX', 'r');
        const [rx, ry] = pt('RF', 'l', 0.85);
        const leftOfRF = C.RF.x - 20;
        g.appendChild(makeWire('wp-wbmux-rf',
            `M ${wx},${wy} H ${wx + 20} V ${wbBackY} H ${leftOfRF} V ${ry} H ${rx}`));
    }

    // MEM/WB RD → RF bottom (write address input)
    // Long backward wire via bottom corridor, enters RF from the bottom
    {
        const [cx, cy] = cellPt('memwb-rd', 'r');
        const [rx, ry] = pt('RF', 'b', 0.6);
        g.appendChild(makeWire('wp-memwb-rf-rd',
            `M ${cx},${cy} H ${cx + 10} V ${wbBackY + 12} H ${rx} V ${ry}`, 'wire-ctrl'));
    }

    // MEM/WB Ctrl (reg_write_en) → RF bottom (write enable input)
    {
        const [cx, cy] = cellPt('memwb-ctrl', 'r');
        const [rx, ry] = pt('RF', 'b', 0.75);
        g.appendChild(makeWire('wp-memwb-rf-ctrl',
            `M ${cx},${cy} H ${cx + 20} V ${wbBackY + 22} H ${rx} V ${ry}`, 'wire-ctrl'));
    }

    // ── Forwarding wires (green) ─────────────────────────────────────────
    //
    // KEY RULES (from reference diagram):
    // 1. No vertical wire passes through FA or FB at their x
    // 2. Wires to FA enter horizontally through the gap (y=360–560)
    // 3. Wires to FB enter from below (y>670)
    // 4. All forwarding data comes from pipe regs, down to bottom corridor,
    //    left along bottom, up on fwdRailX (far left of muxes), then right to mux
    //
    // fwdRailX is defined above (~1180, 100px left of FA/FB)
    //

    // EX/MEM ALU Res → FWD_MUX_A mid input
    // Route through BOTTOM corridor (not gap) to avoid cutting through ALU & FWD_UNIT
    {
        const [mx, my] = pt('FWD_MUX_A', 'l', 0.50);
        const [cx, cy] = cellPt('exmem-alur', 'r');
        g.appendChild(makeWire('wp-fwd-exmem-a',
            `M ${cx},${cy} H ${cx + 10} V ${belowAllY + 15} H ${fwdRailX + 15} V ${my} H ${mx}`, 'wire-fwd'));
    }

    // MEM/WB result → FWD_MUX_A bottom input
    // Route through BOTTOM corridor to avoid cutting through ALU & FWD_UNIT
    {
        const [mx, my] = pt('FWD_MUX_A', 'l', 0.82);
        const [cx, cy] = cellPt('memwb-alur', 'r');
        g.appendChild(makeWire('wp-fwd-memwb-a',
            `M ${cx},${cy} H ${cx + 15} V ${belowAllY + 35} H ${fwdRailX - 5} V ${my} H ${mx}`, 'wire-fwd'));
    }

    // EX/MEM ALU Res → FWD_MUX_B mid input
    // Route: from pipe reg → down below FB → left → up to FB
    {
        const [mx, my] = pt('FWD_MUX_B', 'l', 0.50);
        const [cx, cy] = cellPt('exmem-alur', 'r');
        g.appendChild(makeWire('wp-fwd-exmem-b',
            `M ${cx},${cy} H ${cx + 12} V ${belowAllY + 10} H ${fwdRailX} V ${my} H ${mx}`, 'wire-fwd'));
    }

    // MEM/WB result → FWD_MUX_B bottom input
    // Route: from pipe reg → down below FB → left → up to FB
    {
        const [mx, my] = pt('FWD_MUX_B', 'l', 0.82);
        const [cx, cy] = cellPt('memwb-alur', 'r');
        g.appendChild(makeWire('wp-fwd-memwb-b',
            `M ${cx},${cy} H ${cx + 18} V ${belowAllY + 30} H ${fwdRailX - 20} V ${my} H ${mx}`, 'wire-fwd'));
    }

    // ── Hazard unit wires ────────────────────────────────────────────────
    // Stall output → PC and IF/ID (already wired)
    {
        const [hx, hy] = pt('HAZ_UNIT', 'l');
        const stallY = bottomCorr + 20;
        g.appendChild(makeWire('wp-haz-stall',
            `M ${hx},${hy} H ${hx - 20} V ${stallY} H ${C.PC.x + C.PC.w/2} V ${C.PC.y + C.PC.h}`, 'wire-ctrl'));
    }

    // HAZ_UNIT input wires:
    //   FE rs1/rs2 come from ID stage → drop below all EX muxes (belowAllY+90/102),
    //   run right past IDEX, drop to HAZ_UNIT level, enter left face.
    //   IDEX rd and ctrl exit IDEX right → step right, rise/drop to HAZ_UNIT level, enter left.
    {
        // FE rs1_addr → HAZ_UNIT left (top quarter)
        {
            const [fx, fy] = pt('FE', 'r', 0.2);
            const [hx, hy] = pt('HAZ_UNIT', 'l', 0.2);
            g.appendChild(makeWire('wp-fe-hazunit-rs1',
                `M ${fx},${fy} V ${belowAllY + 90} H ${hx - 5} V ${hy} H ${hx}`, 'wire-ctrl'));
        }
        // FE rs2_addr → HAZ_UNIT left (top half)
        {
            const [fx, fy] = pt('FE', 'r', 0.55);
            const [hx, hy] = pt('HAZ_UNIT', 'l', 0.4);
            g.appendChild(makeWire('wp-fe-hazunit-rs2',
                `M ${fx},${fy} V ${belowAllY + 102} H ${hx - 5} V ${hy} H ${hx}`, 'wire-ctrl'));
        }
        // IDEX rd_addr → HAZ_UNIT left (bottom half)
        // idex-rd is roughly mid-lower IDEX bar, above HAZ_UNIT — short rightward hop
        {
            const [cx, cy] = cellPt('idex-rd', 'r');
            const [hx, hy] = pt('HAZ_UNIT', 'l', 0.6);
            g.appendChild(makeWire('wp-idex-hazunit-rd',
                `M ${cx},${cy} H ${hx - 5} V ${hy} H ${hx}`, 'wire-ctrl'));
        }
        // IDEX ctrl (mem_read) → HAZ_UNIT left (bottom quarter)
        // idex-ctrl is in lower IDEX bar, below HAZ_UNIT — exit right then rise up
        {
            const [cx, cy] = cellPt('idex-ctrl', 'r');
            const [hx, hy] = pt('HAZ_UNIT', 'l', 0.8);
            g.appendChild(makeWire('wp-idex-hazunit-ctrl',
                `M ${cx},${cy} H ${hx - 5} V ${hy} H ${hx}`, 'wire-ctrl'));
        }
    }

    // ── Forwarding unit → forwarding muxes (ctrl select) ─────────────────
    // FWD_UNIT is to the RIGHT of ALU. Ctrl wires must go DOWN through the
    // gap between ALU right edge and FWD_UNIT left edge, then LEFT via
    // the bottom corridor (below all components), then UP to the mux.
    //
    const aluFwdGapX = C.ALU.x + C.ALU.w + 10;           // gap between ALU & FWD_UNIT
    const outsideFAFBx = C.FWD_MUX_A.x - 15;             // left of FA/FB x range

    // FA ctrl: down through gap → bottom corridor → left of FA → up to FA bottom
    {
        const [fx, fy] = pt('FWD_UNIT', 'l');
        const faBottomX = C.FWD_MUX_A.x + C.FWD_MUX_A.w / 2;
        const faBottomY = C.FWD_MUX_A.y + C.FWD_MUX_A.h;
        g.appendChild(makeWire('wp-fwdunit-muxa',
            `M ${fx},${fy} H ${aluFwdGapX} V ${belowAllY + 50} H ${outsideFAFBx} V ${faBottomY + 15} H ${faBottomX} V ${faBottomY}`, 'wire-ctrl'));
    }
    // FB ctrl: down through gap → bottom corridor → left of FB → up to FB bottom
    {
        const [fx, fy] = pt('FWD_UNIT', 'l', 0.7);
        const fbBottomX = C.FWD_MUX_B.x + C.FWD_MUX_B.w / 2;
        const fbBottomY = C.FWD_MUX_B.y + C.FWD_MUX_B.h;
        g.appendChild(makeWire('wp-fwdunit-muxb',
            `M ${fx},${fy + 15} H ${aluFwdGapX - 5} V ${belowAllY + 60} H ${outsideFAFBx - 10} V ${fbBottomY + 15} H ${fbBottomX} V ${fbBottomY}`, 'wire-ctrl'));
    }

    // ── FWD_UNIT input wires ──────────────────────────────────────────────
    // Left inputs: ID/EX rs1_addr and rs2_addr → FWD_UNIT left face
    //   Route down via bottom corridor (belowAllY+70/82), then through aluFwdGapX, up to FWD_UNIT
    // Right inputs: EX/MEM and MEM/WB rd_addr + reg_write_en → FWD_UNIT right face
    //   Route left to rightOfBranch (clear of BRANCH x range), then up to FWD_UNIT right
    {
        const fwdUnitRight  = C.FWD_UNIT.x + C.FWD_UNIT.w;           // 1960
        const rightOfBranch = C.BRANCH.x + C.BRANCH.w + 15;          // 1985 — clear of BRANCH

        const fwdBotY = C.FWD_UNIT.y + C.FWD_UNIT.h; // bottom face y

        // ID/EX RS1 addr → FWD_UNIT BOTTOM (left third)
        // Down to below-corridor, right to bottom-face x, up into bottom face.
        {
            const [cx, cy] = cellPt('idex-rs1a', 'r');
            const botX = C.FWD_UNIT.x + C.FWD_UNIT.w * 0.3;
            g.appendChild(makeWire('wp-idex-fwdunit-rs1a',
                `M ${cx},${cy} H ${cx + 10} V ${belowAllY + 70} H ${botX} V ${fwdBotY}`, 'wire-ctrl'));
        }
        // ID/EX RS2 addr → FWD_UNIT BOTTOM (right third)
        {
            const [cx, cy] = cellPt('idex-rs2a', 'r');
            const botX = C.FWD_UNIT.x + C.FWD_UNIT.w * 0.65;
            g.appendChild(makeWire('wp-idex-fwdunit-rs2a',
                `M ${cx},${cy} H ${cx + 10} V ${belowAllY + 82} H ${botX} V ${fwdBotY}`, 'wire-ctrl'));
        }

        // Right face inputs — spread across full 130px height (≈32px apart each)
        // EX/MEM RD → FWD_UNIT right (fraction 0.12)
        // Route: exit right side of EX/MEM → loop back via bottom corridor
        {
            const [cx, cy] = cellPt('exmem-rd', 'r');
            const [, fy]   = pt('FWD_UNIT', 'r', 0.12);
            const loopY = BOTTOM_Y - 50;
            g.appendChild(makeWire('wp-exmem-fwdunit-rd',
                `M ${cx},${cy} H ${cx + 15} V ${loopY} H ${rightOfBranch} V ${fy} H ${fwdUnitRight}`, 'wire-ctrl'));
        }
        // EX/MEM reg_write_en → FWD_UNIT right (fraction 0.37)
        // Route: exit right side of EX/MEM → loop back via bottom corridor
        {
            const [cx, cy] = cellPt('exmem-ctrl', 'r');
            const [, fy]   = pt('FWD_UNIT', 'r', 0.37);
            const loopY = BOTTOM_Y - 35;
            g.appendChild(makeWire('wp-exmem-fwdunit-ctrl',
                `M ${cx},${cy} H ${cx + 20} V ${loopY} H ${rightOfBranch + 12} V ${fy} H ${fwdUnitRight}`, 'wire-ctrl'));
        }
        // MEM/WB RD → FWD_UNIT right (fraction 0.63)
        // Route: exit right side of MEM/WB → loop back via bottom corridor
        {
            const [cx, cy] = cellPt('memwb-rd', 'r');
            const [, fy]   = pt('FWD_UNIT', 'r', 0.63);
            const loopY = BOTTOM_Y - 20;
            g.appendChild(makeWire('wp-memwb-fwdunit-rd',
                `M ${cx},${cy} H ${cx + 15} V ${loopY} H ${rightOfBranch + 24} V ${fy} H ${fwdUnitRight}`, 'wire-ctrl'));
        }
        // MEM/WB reg_write_en → FWD_UNIT right (fraction 0.88)
        // Route: exit right side of MEM/WB → loop back via bottom corridor
        {
            const [cx, cy] = cellPt('memwb-ctrl', 'r');
            const [, fy]   = pt('FWD_UNIT', 'r', 0.88);
            const loopY = BOTTOM_Y - 5;
            g.appendChild(makeWire('wp-memwb-fwdunit-ctrl',
                `M ${cx},${cy} H ${cx + 20} V ${loopY} H ${rightOfBranch + 36} V ${fy} H ${fwdUnitRight}`, 'wire-ctrl'));
        }
    }

    // ── Stage instruction labels ─────────────────────────────────────────
    for (const [key, label] of [['IF','if'], ['ID','id'], ['EX','ex'], ['MEM','mem'], ['WB','wb']]) {
        const s = STAGE[key];
        const t = txt(`vp-stage-instr-${label}`, s.x + s.w / 2, STAGE_LABEL_Y + 16, 'stage-instr', '');
        t.setAttribute('text-anchor', 'middle');
        g.appendChild(t);
    }

    // ── Stall/Flush status labels on pipeline register bars ──────────────
    for (const key of ['IFID', 'IDEX', 'EXMEM', 'MEMWB']) {
        const s = STAGE[key];
        const t = txt(`vp-preg-status-${key}`, s.x + s.w / 2, PREG_Y + PREG_H - 10, 'preg-status', '');
        t.setAttribute('text-anchor', 'middle');
        g.appendChild(t);
    }

    // ── Bring all text + label backgrounds to front ──────────────────────
    Array.from(g.querySelectorAll('text, rect.wire-label-bg'))
         .forEach(node => g.appendChild(node));
}

// ══════════════════════════════════════════════════════════════════════════════
//  Helpers for updatePipeDatapath
// ══════════════════════════════════════════════════════════════════════════════

function set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setWire(id, active, typeOrCtrl = false) {
    const el = document.getElementById(id);
    if (!el) return;
    const type = typeOrCtrl === true ? 'ctrl'
               : typeOrCtrl === 'fwd' ? 'fwd'
               : typeOrCtrl === 'instr' ? 'instr'
               : typeOrCtrl === false ? 'data'
               : typeOrCtrl;
    const base = `wire-${type}`;
    el.setAttribute('class', active ? base : `${base} inactive`);
    el.setAttribute('marker-end', `url(#arrow-${active ? type : 'inactive'})`);
}

function setRegBox(i, cls) {
    const b = document.getElementById(`reg-box-${i}`);
    if (b) b.setAttribute('class', `reg-box ${cls}`);
}

function setPipeRegStatus(key, status) {
    const el = document.getElementById(`vp-preg-status-${key}`);
    if (!el) return;
    el.textContent = status;
    el.setAttribute('class', 'preg-status' + (status === 'STALL' ? ' stall' : status === 'FLUSH' ? ' flush' : status === 'BUBBLE' ? ' bubble' : ''));
}

function setPipeRegHighlight(key, state) {
    const el = document.getElementById(`preg-${key}`);
    if (!el) return;
    let cls = 'pipe-reg';
    if (state === 'stall') cls += ' pipe-reg-stall';
    if (state === 'flush') cls += ' pipe-reg-flush';
    el.setAttribute('class', cls);
}

function fmtV(v, fmt) {
    const u = v >>> 0;
    if (fmt === 'hex') return '0x' + u.toString(16).toUpperCase().padStart(8, '0');
    return u.toString(10);
}

function fmtShort(v, fmt) {
    const u = v >>> 0;
    if (fmt === 'hex') return '0x' + u.toString(16).toUpperCase();
    return (v | 0).toString(10);
}

// ── Disassembly helpers (local, no cpu_pipe import) ──────────────────────────

function fieldExtractLocal(instr) {
    return {
        opcode: instr & 0x7F, rd: (instr>>>7)&0x1F, funct3: (instr>>>12)&0x07,
        rs1: (instr>>>15)&0x1F, rs2: (instr>>>20)&0x1F, funct7: (instr>>>25)&0x7F,
    };
}

function immGenLocal(instr, opcode) {
    switch (opcode) {
        case 0x03: case 0x13: case 0x67: return instr >> 20;
        case 0x23: return ((instr>>25)&0x7F)<<5 | ((instr>>>7)&0x1F) | (instr&0x80000000 ? 0xFFFFF000 : 0);
        case 0x63: { const b12=(instr>>>31)&1,b11=(instr>>>7)&1,b10_5=(instr>>>25)&0x3F,b4_1=(instr>>>8)&0xF; return ((b12?0xFFFFF000:0)|(b12<<12)|(b11<<11)|(b10_5<<5)|(b4_1<<1)); }
        case 0x37: case 0x17: return (instr & 0xFFFFF000)|0;
        case 0x6F: { const b20=(instr>>>31)&1,b19_12=(instr>>>12)&0xFF,b11=(instr>>>20)&1,b10_1=(instr>>>21)&0x3FF; return ((b20?0xFFF00000:0)|(b20<<20)|(b19_12<<12)|(b11<<11)|(b10_1<<1)); }
        default: return 0;
    }
}

function disasm(instr) {
    if (instr === 0x00000013) return 'NOP';
    const f = fieldExtractLocal(instr);
    const R  = n => `x${n}`;
    const im = () => (immGenLocal(instr, f.opcode) | 0).toString(10);

    switch (f.opcode) {
        case 0x33: {
            const ops = { 0:['ADD','SUB'], 1:['SLL'], 2:['SLT'], 3:['SLTU'],
                          4:['XOR'], 5:['SRL','SRA'], 6:['OR'], 7:['AND'] };
            const pair = ops[f.funct3] || ['?'];
            const nm = (f.funct3===0||f.funct3===5) ? (f.funct7===0x20 ? pair[1] : pair[0]) : pair[0];
            return `${nm} ${R(f.rd)},${R(f.rs1)},${R(f.rs2)}`;
        }
        case 0x13: {
            const nm = {0:'ADDI',1:'SLLI',2:'SLTI',3:'SLTIU',4:'XORI',5:f.funct7===0x20?'SRAI':'SRLI',6:'ORI',7:'ANDI'}[f.funct3]||'?';
            return `${nm} ${R(f.rd)},${R(f.rs1)},${im()}`;
        }
        case 0x03: { const nm = {0:'LB',1:'LH',2:'LW',4:'LBU',5:'LHU'}[f.funct3]||'?'; return `${nm} ${R(f.rd)},${im()}(${R(f.rs1)})`; }
        case 0x23: { const nm = {0:'SB',1:'SH',2:'SW'}[f.funct3]||'?'; return `${nm} ${R(f.rs2)},${im()}(${R(f.rs1)})`; }
        case 0x63: { const nm = {0:'BEQ',1:'BNE',4:'BLT',5:'BGE',6:'BLTU',7:'BGEU'}[f.funct3]||'?'; return `${nm} ${R(f.rs1)},${R(f.rs2)},${im()}`; }
        case 0x37: return `LUI ${R(f.rd)},${((immGenLocal(instr,f.opcode)>>>0)>>>12)}`;
        case 0x17: return `AUIPC ${R(f.rd)},${((immGenLocal(instr,f.opcode)>>>0)>>>12)}`;
        case 0x6F: return `JAL ${R(f.rd)},${im()}`;
        case 0x67: return `JALR ${R(f.rd)},${R(f.rs1)},${im()}`;
        case 0x73: return instr === 0x00100073 ? 'EBREAK' : 'ECALL';
        default:   return '???';
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  updatePipeDatapath
// ══════════════════════════════════════════════════════════════════════════════

export function updatePipeDatapath(snap, fmt) {
    if (!snap) return;

    const { if_stage, id_stage, ex_stage, mem_stage, wb_stage, pipe_regs, stall, flush } = snap;

    // ── Stage instruction labels ─────────────────────────────────────────
    set('vp-stage-instr-if',  disasm(if_stage.instr));
    set('vp-stage-instr-id',  disasm(id_stage.instr));
    set('vp-stage-instr-ex',  ex_stage.bubble ? 'BUBBLE' : disasm(ex_stage.instr));
    set('vp-stage-instr-mem', mem_stage.bubble ? 'BUBBLE' : disasm(mem_stage.instr));
    set('vp-stage-instr-wb',  wb_stage.bubble ? 'BUBBLE' : disasm(wb_stage.instr));

    // ── IF stage ─────────────────────────────────────────────────────────
    set('vp-pc',        fmtV(if_stage.pc, fmt));
    set('vp-pc4',       fmtV((if_stage.pc + 4) >>> 0, fmt));
    set('vp-imem-addr', fmtV(if_stage.pc, fmt));
    set('vp-instr',     '0x' + (if_stage.instr>>>0).toString(16).toUpperCase().padStart(8,'0'));
    set('vp-asm',       disasm(if_stage.instr));
    set('vp-nextmux-sel', flush ? '1→tgt' : '0→+4');

    // ── ID stage ─────────────────────────────────────────────────────────
    const idf = id_stage.fields;
    set('vp-opcode', '0x' + idf.opcode.toString(16).toUpperCase().padStart(2,'0'));
    set('vp-rd',     `x${idf.rd}`);
    set('vp-rs1',    `x${idf.rs1}`);
    set('vp-rs2',    `x${idf.rs2}`);
    set('vp-f3',     '0x' + idf.funct3.toString(16));
    set('vp-f7',     '0x' + idf.funct7.toString(16).padStart(2,'0'));
    set('vp-imm',    fmtShort(id_stage.imm, fmt));
    set('vp-dec-ctrl', id_stage.ctrl.reg_write_en ? 'active' : '—');
    set('vp-dec-aluop', ALU_NAMES[id_stage.ctrl.alu_op] || '?');

    // ── EX stage ─────────────────────────────────────────────────────────
    set('vp-alua',   fmtV(ex_stage.alu_a, fmt));
    set('vp-alub',   fmtV(ex_stage.alu_b, fmt));
    set('vp-aluop',  ALU_NAMES[ex_stage.alu_op] || '?');
    set('vp-alur',   fmtV(ex_stage.alu_result, fmt));
    set('vp-bl-br',  ex_stage.branch.toString());
    set('vp-bl-jmp', ex_stage.jump.toString());
    set('vp-bl-f3',  '0x' + ex_stage.funct3.toString(16));
    set('vp-pcsrc',  ex_stage.pc_src.toString());
    set('vp-pcimm',  fmtV(ex_stage.pc_plus_imm, fmt));
    set('vp-expc4',  fmtV(ex_stage.pc_plus4, fmt));
    set('vp-pctgt',  fmtV(ex_stage.branch_target, fmt));
    set('vp-muxa-sel', ex_stage.alu_src_a ? '1→pc' : '0→rs1');
    set('vp-muxb-sel', ex_stage.alu_src_b ? '1→imm' : '0→rs2');
    set('vp-fwda-sel', ['00→reg','01→exmem','10→memwb'][ex_stage.forward_a] || '?');
    set('vp-fwdb-sel', ['00→reg','01→exmem','10→memwb'][ex_stage.forward_b] || '?');
    set('vp-fwd-a',  ex_stage.forward_a.toString(2).padStart(2,'0'));
    set('vp-fwd-b',  ex_stage.forward_b.toString(2).padStart(2,'0'));
    set('vp-stall', stall ? '1' : '0');

    // ── MEM stage ────────────────────────────────────────────────────────
    set('vp-dmem-addr',  fmtV(mem_stage.alu_result, fmt));
    set('vp-dmem-wdata', fmtV(mem_stage.rs2_data, fmt));
    set('vp-dmem-we',    mem_stage.mem_write.toString());
    set('vp-dmem-re',    mem_stage.mem_read.toString());
    set('vp-dmrd',       fmtV(mem_stage.mem_rd_data, fmt));

    // ── WB stage ─────────────────────────────────────────────────────────
    set('vp-wbmux-sel', ['00→pc+4','01→alu','10→mem'][wb_stage.wb_sel] || '?');

    // ── Pipeline register cell values ────────────────────────────────────
    const pr = pipe_regs;

    // IF/ID
    set('vp-ifid-pc',    fmtShort(pr.ifid.pc, fmt));
    set('vp-ifid-instr', '0x'+(pr.ifid.instr>>>0).toString(16).toUpperCase().padStart(8,'0'));

    // ID/EX
    set('vp-idex-pc',    fmtShort(pr.idex.pc, fmt));
    set('vp-idex-rs1d',  fmtShort(pr.idex.rs1_data, fmt));
    set('vp-idex-rs2d',  fmtShort(pr.idex.rs2_data, fmt));
    set('vp-idex-imm',   fmtShort(pr.idex.imm, fmt));
    set('vp-idex-rs1a',  `x${pr.idex.rs1_addr}`);
    set('vp-idex-rs2a',  `x${pr.idex.rs2_addr}`);
    set('vp-idex-rd',    `x${pr.idex.rd_addr}`);
    set('vp-idex-f3',    '0x' + pr.idex.funct3.toString(16));
    set('vp-idex-ctrl',  pr.idex.reg_write_en ? ALU_NAMES[pr.idex.alu_op] || '?' : '—');

    // EX/MEM
    set('vp-exmem-alur',  fmtShort(pr.exmem.alu_result, fmt));
    set('vp-exmem-rs2d',  fmtShort(pr.exmem.rs2_data, fmt));
    set('vp-exmem-pc4',   fmtShort(pr.exmem.pc_plus4, fmt));
    set('vp-exmem-rd',    `x${pr.exmem.rd_addr}`);
    set('vp-exmem-ctrl',  pr.exmem.reg_write_en ? 'WB' : pr.exmem.mem_write ? 'ST' : pr.exmem.mem_read ? 'LD' : '—');

    // MEM/WB
    set('vp-memwb-alur',  fmtShort(pr.memwb.alu_result, fmt));
    set('vp-memwb-memd',  fmtShort(pr.memwb.mem_data, fmt));
    set('vp-memwb-pc4',   fmtShort(pr.memwb.pc_plus4, fmt));
    set('vp-memwb-rd',    `x${pr.memwb.rd_addr}`);
    set('vp-memwb-ctrl',  pr.memwb.reg_write_en ? 'WB' : '—');

    // ── Pipeline register highlights ─────────────────────────────────────
    setPipeRegHighlight('IFID',  stall ? 'stall' : flush ? 'flush' : '');
    setPipeRegHighlight('IDEX',  (stall || flush) ? 'flush' : '');
    setPipeRegHighlight('EXMEM', '');
    setPipeRegHighlight('MEMWB', '');

    setPipeRegStatus('IFID',  stall ? 'STALL' : flush ? 'FLUSH' : '');
    setPipeRegStatus('IDEX',  (stall || flush) ? 'BUBBLE' : '');
    setPipeRegStatus('EXMEM', '');
    setPipeRegStatus('MEMWB', '');

    // ── Register file ────────────────────────────────────────────────────
    for (let i = 0; i < 32; i++) {
        const v = (snap.regs[i] >>> 0);
        const t = document.getElementById(`reg-val-${i}`);
        if (t) {
            t.textContent = fmt === 'hex'
                ? v.toString(16).toUpperCase().padStart(8,'0')
                : v.toString(10).padStart(10,' ');
        }
        let cls = '';
        if (i === wb_stage.rd_addr && wb_stage.reg_write_en && i !== 0) cls = 'rd';
        else if (i === id_stage.fields.rs1 && i !== 0) cls = 'rs1';
        else if (i === id_stage.fields.rs2 && i !== 0) cls = 'rs2';
        setRegBox(i, cls);
    }

    // ── Wire active/inactive ─────────────────────────────────────────────
    const isBranch = ex_stage.branch === 1;
    const isJump   = ex_stage.jump === 1;
    const taken    = ex_stage.pc_src === 1;
    const isLoad   = mem_stage.mem_read === 1;
    const isStore  = mem_stage.mem_write === 1;
    const fwdA     = ex_stage.forward_a;
    const fwdB     = ex_stage.forward_b;

    // IF
    setWire('wp-nextmux-pc',    true);
    setWire('wp-pc-imem',       true);
    setWire('wp-pc-pc4',        true);
    setWire('wp-pc4-nextmux',   !taken);
    setWire('wp-imem-ifid',     true);
    setWire('wp-pc-ifid',       true);

    // ID
    setWire('wp-ifid-fe',       true);
    setWire('wp-ifid-immgen',   true);
    setWire('wp-fe-rf',         true);
    setWire('wp-fe-dec',        true, 'instr');
    setWire('wp-rf-idex-rs1',   true);
    setWire('wp-rf-idex-rs2',   true);
    setWire('wp-immgen-idex',   true);
    setWire('wp-dec-idex',      true, true);
    setWire('wp-ifid-idex-pc',  true);
    setWire('wp-fe-idex-rd',    true);

    // EX
    setWire('wp-idex-fwda',     fwdA === 0);
    setWire('wp-idex-fwdb',     fwdB === 0);
    setWire('wp-fwda-muxa',     true);
    setWire('wp-fwdb-muxb',     true);
    setWire('wp-idex-muxa-pc',  ex_stage.alu_src_a === 1);
    setWire('wp-idex-muxb-imm', ex_stage.alu_src_b === 1);
    setWire('wp-muxa-alu',      true);
    setWire('wp-muxb-alu',      true);
    setWire('wp-alu-branch',    isBranch || isJump);
    setWire('wp-alu-exmem',     true);
    setWire('wp-alu-brmux',     ex_stage.PC_or_Rs1_mux === 1);
    setWire('wp-rs2-exmem',     true);
    setWire('wp-idex-pcimm-pc', isBranch || isJump);
    setWire('wp-idex-pcimm-imm',isBranch || isJump);
    setWire('wp-pcimm-brmux',   !ex_stage.PC_or_Rs1_mux);
    setWire('wp-brmux-branch',  isBranch || isJump);
    setWire('wp-brmux-nextmux', taken);
    setWire('wp-idex-expc4',    true);
    setWire('wp-expc4-exmem',   true);
    setWire('wp-idex-branch',   isBranch || isJump, true);
    setWire('wp-branch-nextmux',isBranch || isJump, true);
    setWire('wp-idex-brmux-ctrl', ex_stage.PC_or_Rs1_mux !== undefined, true);

    // MEM
    setWire('wp-exmem-dmem-addr',  true);
    setWire('wp-exmem-dmem-wdata', isStore);
    setWire('wp-exmem-dmem-ctrl',  isLoad || isStore, true);
    setWire('wp-dmem-memwb',       isLoad);
    setWire('wp-exmem-memwb-alu',  true);
    setWire('wp-exmem-memwb-pc4',  true);
    setWire('wp-exmem-memwb-rd',   true);
    setWire('wp-exmem-memwb-ctrl', true, true);

    // WB
    setWire('wp-memwb-wbmux-pc4', wb_stage.wb_sel === 0b00);
    setWire('wp-memwb-wbmux-alu', wb_stage.wb_sel === 0b01);
    setWire('wp-memwb-wbmux-mem', wb_stage.wb_sel === 0b10);
    setWire('wp-wbmux-rf',       wb_stage.reg_write_en === 1);

    // Forwarding (green)
    setWire('wp-fwd-exmem-a',   fwdA === 0b01, 'fwd');
    setWire('wp-fwd-exmem-b',   fwdB === 0b01, 'fwd');
    setWire('wp-fwd-memwb-a',   fwdA === 0b10, 'fwd');
    setWire('wp-fwd-memwb-b',   fwdB === 0b10, 'fwd');

    // Hazard/forwarding ctrl
    setWire('wp-haz-stall',     stall === 1, true);
    setWire('wp-fwdunit-muxa',  fwdA !== 0, true);
    setWire('wp-fwdunit-muxb',  fwdB !== 0, true);

    return {
        if_asm:  disasm(if_stage.instr),
        id_asm:  disasm(id_stage.instr),
        ex_asm:  ex_stage.bubble ? 'BUBBLE' : disasm(ex_stage.instr),
        mem_asm: mem_stage.bubble ? 'BUBBLE' : disasm(mem_stage.instr),
        wb_asm:  wb_stage.bubble ? 'BUBBLE' : disasm(wb_stage.instr),
        stall,
        flush,
    };
}
