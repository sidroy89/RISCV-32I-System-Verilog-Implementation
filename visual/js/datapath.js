'use strict';

// datapath.js — builds the SVG datapath diagram and updates it each cycle.
// buildDatapath(viewport)  — called once on page load
// updateDatapath(snap,fmt) — called every step with the cpu.js signal snapshot

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── ALU op name table (matches cpu.js constants) ──────────────────────────────
const ALU_NAMES = ['ADD','SUB','AND','OR','XOR','SLL','SRL','SRA','SLT','SLTU','PASS_B'];

// ── Component layout  [x, y, w, h] in SVG units ──────────────────────────────
const C = {
    NEXT_MUX : { x:  52, y: 355, w:  52, h: 185 },  // next-PC mux (trapezoid)
    PC       : { x: 180, y: 400, w: 120, h:  80 },
    PC4_ADD  : { x: 180, y: 200, w: 120, h:  70 },
    PC_TGT   : { x: 660, y:  72, w: 120, h:  70 },  // PC/rs1 + imm adder
    MUX_TGT  : { x: 490, y:  80, w:  52, h: 120 },  // PC vs RS1 selector (for JALR)
    IMEM     : { x: 380, y: 330, w: 165, h: 175 },
    FE       : { x: 625, y: 330, w: 150, h: 175 },  // field extractor
    IMM_GEN  : { x: 625, y: 580, w: 150, h:  90 },
    RF       : { x: 855, y: 240, w: 315, h: 490 },  // register file (big box)
    MUX_A    : { x:1250, y: 300, w:  52, h: 165 },  // ALU src A: rs1 vs PC
    MUX_B    : { x:1250, y: 500, w:  52, h: 165 },  // ALU src B: rs2 vs imm
    ALU      : { x:1382, y: 310, w: 165, h: 265 },
    BRANCH   : { x:1647, y: 148, w: 185, h: 170 },
    DMEM     : { x:1932, y: 265, w: 195, h: 330 },
    WB_MUX   : { x: 940, y: 828, w:  52, h: 180 },  // writeback mux (3-to-1)
    DECODER  : { x:  52, y:1060, w:2180, h: 105 },
};

// ── SVG element factory ───────────────────────────────────────────────────────
function el(tag, attrs = {}) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
}

// ── Port helpers — returns [x,y] of a connection point on a component ─────────
function pt(comp, side, frac = 0.5) {
    const c = C[comp];
    switch (side) {
        case 'r': return [c.x + c.w,         c.y + c.h * frac];
        case 'l': return [c.x,                c.y + c.h * frac];
        case 't': return [c.x + c.w * frac,   c.y             ];
        case 'b': return [c.x + c.w * frac,   c.y + c.h       ];
    }
}

// ── Orthogonal wire path (H→V→H) ─────────────────────────────────────────────
// mid_x: optional x for the vertical segment; defaults to midpoint
function wirePath([x1,y1], [x2,y2], midX) {
    const mx = midX !== undefined ? midX : (x1 + x2) / 2;
    if (Math.abs(y1 - y2) < 1) return `M ${x1},${y1} H ${x2}`;   // straight
    return `M ${x1},${y1} H ${mx} V ${y2} H ${x2}`;
}

// direct vertical (V→H)
function wireVH([x1,y1], [x2,y2]) {
    return `M ${x1},${y1} V ${y2} H ${x2}`;
}

// H→V
function wireHV([x1,y1], [x2,y2]) {
    return `M ${x1},${y1} H ${x2} V ${y2}`;
}

// ── Create a wire path element ────────────────────────────────────────────────
function makeWire(id, d, cls = 'wire-data') {
    const markerMap = { 'wire-ctrl': 'ctrl', 'wire-instr': 'instr' };
    const marker = markerMap[cls] || 'data';
    return el('path', { id, d, class: cls, fill: 'none', 'marker-end': `url(#arrow-${marker})` });
}

// ── Text helpers ──────────────────────────────────────────────────────────────
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

// Mux input label with opaque background so wires can't cover it.
function muxLbl(g, x, y, content) {
    const w = content.length * 6 + 6;
    const bg = el('rect', { x: x - 2, y: y - 12, width: w, height: 13,
                             class: 'wire-label-bg', rx: 2 });
    const t = el('text', { x, y: y - 2, class: 'sig-name' });
    t.textContent = content;
    g.appendChild(bg);
    g.appendChild(t);
}

// ── Component box (rect + title label) ───────────────────────────────────────
function makeBox(g, comp, cls, title) {
    const { x, y, w, h } = C[comp];
    g.appendChild(el('rect', { x, y, width: w, height: h, class: `comp-box ${cls}`, rx: 6 }));
    if (title) {
        const t = staticTxt(x + 6, y + 13, 'comp-title', title);
        t.setAttribute('fill-opacity', '0.7');
        g.appendChild(t);
    }
}

// ── Signal row: "NAME  [value]" inside a box ─────────────────────────────────
// Returns the value text element (so updateDatapath can find it by id).
function sigRow(g, x, y, label, valId, initVal = '—') {
    g.appendChild(staticTxt(x, y, 'sig-name', label));
    const v = txt(valId, x + 62, y, 'sig-value', initVal);
    g.appendChild(v);
    return v;
}

// ── Mux trapezoid (output on the right) ──────────────────────────────────────
function makeMux(g, comp, cls, label) {
    const { x, y, w, h } = C[comp];
    const inset = h * 0.18;
    const pts = `${x},${y} ${x+w},${y+inset} ${x+w},${y+h-inset} ${x},${y+h}`;
    g.appendChild(el('polygon', { points: pts, class: `comp-box ${cls}` }));
    const t = staticTxt(x + 4, y + h / 2 + 4, 'mux-label', label);
    g.appendChild(t);
}

// ── Wire value label — caller passes the wire's y; label renders ABOVE the wire ─
function wireLabel(g, id, x, y) {
    // bg rect hidden until text is set (avoids dark ghost boxes before program runs)
    // Offset 14px up so the label sits clearly above the wire line.
    const bg = el('rect', { id: id + '-bg', x: x - 2, y: y - 16, width: 88, height: 13,
                             class: 'wire-label-bg', rx: 2, visibility: 'hidden' });
    const t  = txt(id, x, y - 5, 'wire-label', '');
    g.appendChild(bg);
    g.appendChild(t);
}

// ── Register file internals (32 boxes in 2 columns of 16) ────────────────────
function buildRegFile(g) {
    const { x, y, w, h } = C.RF;
    // outer box
    g.appendChild(el('rect', { x, y, width: w, height: h, class: 'regfile-wrap', rx: 6 }));
    g.appendChild(staticTxt(x + 6, y + 13, 'comp-title', 'Register File'));

    const rows    = 16;
    const colW    = (w - 24) / 2;    // width per column
    const rowH    = (h - 32) / rows;  // height per row
    const startY  = y + 28;
    const col0X   = x + 8;
    const col1X   = x + 12 + colW;

    for (let i = 0; i < 32; i++) {
        const col   = i < 16 ? 0 : 1;
        const row   = i % 16;
        const cx    = col === 0 ? col0X : col1X;
        const ry    = startY + row * rowH;

        // register name label (outside/left of box)
        const nameT = staticTxt(cx, ry + rowH * 0.72, 'reg-name', `x${i}`);
        g.appendChild(nameT);

        // value box
        const bx = cx + 20;
        const bw = colW - 24;
        const bh = rowH - 3;
        const rb = el('rect', { id: `reg-box-${i}`, x: bx, y: ry, width: bw, height: bh,
                                 class: 'reg-box', rx: 2 });
        g.appendChild(rb);

        // value text inside box
        const vt = txt(`reg-val-${i}`, bx + bw / 2, ry + bh * 0.72, 'reg-value', '00000000');
        vt.setAttribute('text-anchor', 'middle');
        g.appendChild(vt);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
//  buildDatapath — called once, populates the SVG viewport <g>
// ════════════════════════════════════════════════════════════════════════════════
export function buildDatapath(viewport) {
    const g = viewport;   // alias

    // ── NEXT-PC MUX ────────────────────────────────────────────────────────────
    makeMux(g, 'NEXT_MUX', 'comp-mux', 'MUX');
    // sel label (updated each cycle)
    g.appendChild(txt('v-nextmux-sel', C.NEXT_MUX.x + 2, C.NEXT_MUX.y + C.NEXT_MUX.h + 12,
                       'sig-value', ''));

    // ── PC ─────────────────────────────────────────────────────────────────────
    makeBox(g, 'PC', 'comp-pc', 'PC');
    sigRow(g, C.PC.x+6, C.PC.y+32, 'pc', 'v-pc', '80000000');
    sigRow(g, C.PC.x+6, C.PC.y+50, '→', 'v-pcnext', '80000004');

    // ── PC+4 ADDER ─────────────────────────────────────────────────────────────
    makeBox(g, 'PC4_ADD', 'comp-adder', 'PC+4');
    sigRow(g, C.PC4_ADD.x+6, C.PC4_ADD.y+32, '+4', 'v-pc4', '80000004');

    // ── PC-TARGET ADDER ────────────────────────────────────────────────────────
    makeBox(g, 'PC_TGT', 'comp-adder', 'PC/rs1+imm');
    sigRow(g, C.PC_TGT.x+6, C.PC_TGT.y+36, '→', 'v-pctgt', '—');

    // ── PC/RS1 SELECTOR MUX (feeds PC_TGT base address) ───────────────────────
    makeMux(g, 'MUX_TGT', 'comp-mux', 'T');
    muxLbl(g, C.MUX_TGT.x - 24, C.MUX_TGT.y + C.MUX_TGT.h * 0.22 - 10, 'pc');
    muxLbl(g, C.MUX_TGT.x - 28, C.MUX_TGT.y + C.MUX_TGT.h * 0.78 - 10, 'rs1');
    g.appendChild(txt('v-muxtgt-sel', C.MUX_TGT.x + 4, C.MUX_TGT.y - 8, 'sig-value active', ''));

    // ── INSTRUCTION MEMORY ─────────────────────────────────────────────────────
    makeBox(g, 'IMEM', 'comp-imem', 'Instr Memory');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+32, 'addr', 'v-imem-addr', '—');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+50, 'instr', 'v-instr', '—');
    sigRow(g, C.IMEM.x+6, C.IMEM.y+68, 'asm', 'v-asm', '—');

    // ── FIELD EXTRACTOR ────────────────────────────────────────────────────────
    makeBox(g, 'FE', 'comp-fe', 'Field Extractor');
    sigRow(g, C.FE.x+6, C.FE.y+32, 'op', 'v-opcode', '—');
    sigRow(g, C.FE.x+6, C.FE.y+48, 'rd', 'v-rd',     '—');
    sigRow(g, C.FE.x+6, C.FE.y+64, 'rs1', 'v-rs1',   '—');
    sigRow(g, C.FE.x+6, C.FE.y+80, 'rs2', 'v-rs2',   '—');
    sigRow(g, C.FE.x+6, C.FE.y+96, 'f3', 'v-f3',     '—');
    sigRow(g, C.FE.x+6, C.FE.y+112,'f7', 'v-f7',     '—');

    // ── IMMEDIATE GENERATOR ────────────────────────────────────────────────────
    makeBox(g, 'IMM_GEN', 'comp-immgen', 'Imm Gen');
    sigRow(g, C.IMM_GEN.x+6, C.IMM_GEN.y+34, 'imm', 'v-imm', '—');
    sigRow(g, C.IMM_GEN.x+6, C.IMM_GEN.y+52, 'hex', 'v-imm-h', '—');

    // ── REGISTER FILE ─────────────────────────────────────────────────────────
    buildRegFile(g);

    // ── MUX A (ALU input A: rs1 or PC) ────────────────────────────────────────
    makeMux(g, 'MUX_A', 'comp-mux', 'A');
    muxLbl(g, C.MUX_A.x - 32, C.MUX_A.y + C.MUX_A.h * 0.22 - 10, 'rs1');
    muxLbl(g, C.MUX_A.x - 24, C.MUX_A.y + C.MUX_A.h * 0.78 - 10, 'pc');
    g.appendChild(txt('v-muxa-sel', C.MUX_A.x + 4, C.MUX_A.y - 8, 'sig-value active', ''));

    // ── MUX B (ALU input B: rs2 or imm) ───────────────────────────────────────
    makeMux(g, 'MUX_B', 'comp-mux', 'B');
    muxLbl(g, C.MUX_B.x - 32, C.MUX_B.y + C.MUX_B.h * 0.22 - 10, 'rs2');
    muxLbl(g, C.MUX_B.x - 32, C.MUX_B.y + C.MUX_B.h * 0.78 - 10, 'imm');
    g.appendChild(txt('v-muxb-sel', C.MUX_B.x + 4, C.MUX_B.y - 8, 'sig-value active', ''));

    // ── ALU ────────────────────────────────────────────────────────────────────
    makeBox(g, 'ALU', 'comp-alu', 'ALU');
    sigRow(g, C.ALU.x+6, C.ALU.y+ 32, 'A',   'v-alua',  '—');
    sigRow(g, C.ALU.x+6, C.ALU.y+ 52, 'B',   'v-alub',  '—');
    sigRow(g, C.ALU.x+6, C.ALU.y+ 72, 'op',  'v-aluop', '—');
    g.appendChild(el('line', { x1: C.ALU.x+6, y1: C.ALU.y+82, x2: C.ALU.x+C.ALU.w-6, y2: C.ALU.y+82,
                                stroke: 'var(--border)', 'stroke-width': 1 }));
    sigRow(g, C.ALU.x+6, C.ALU.y+100, 'res', 'v-alur',  '—');
    sigRow(g, C.ALU.x+6, C.ALU.y+118, 'zero','v-aluz',  '—');

    // ── BRANCH LOGIC ──────────────────────────────────────────────────────────
    makeBox(g, 'BRANCH', 'comp-branch', 'Branch Logic');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+ 32, 'f3',   'v-bl-f3',  '—');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+ 50, 'br',   'v-bl-br',  '—');
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+ 68, 'jmp',  'v-bl-jmp', '—');
    g.appendChild(el('line', { x1: C.BRANCH.x+6, y1: C.BRANCH.y+78, x2: C.BRANCH.x+C.BRANCH.w-6, y2: C.BRANCH.y+78,
                                stroke: 'var(--border)', 'stroke-width': 1 }));
    sigRow(g, C.BRANCH.x+6, C.BRANCH.y+ 96, 'pc_src','v-pcsrc', '—');

    // ── DATA MEMORY ───────────────────────────────────────────────────────────
    makeBox(g, 'DMEM', 'comp-dmem', 'Data Memory');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+ 32, 'addr',   'v-dmem-addr', '—');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+ 52, 'wdata',  'v-dmem-wdata','—');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+ 72, 'we',     'v-dmem-we',   '0');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+ 92, 're',     'v-dmem-re',   '0');
    sigRow(g, C.DMEM.x+6, C.DMEM.y+112, 'f3',     'v-dmem-f3',   '—');
    g.appendChild(el('line', { x1: C.DMEM.x+6, y1: C.DMEM.y+122, x2: C.DMEM.x+C.DMEM.w-6, y2: C.DMEM.y+122,
                                stroke: 'var(--border)', 'stroke-width': 1 }));
    sigRow(g, C.DMEM.x+6, C.DMEM.y+140, 'rdata', 'v-dmrd', '—');

    // ── WRITEBACK MUX ─────────────────────────────────────────────────────────
    makeMux(g, 'WB_MUX', 'comp-mux', 'WB');
    muxLbl(g, C.WB_MUX.x - 36, C.WB_MUX.y + C.WB_MUX.h * 0.18 - 10, 'pc+4');
    muxLbl(g, C.WB_MUX.x - 28, C.WB_MUX.y + C.WB_MUX.h * 0.5  - 10, 'alu');
    muxLbl(g, C.WB_MUX.x - 28, C.WB_MUX.y + C.WB_MUX.h * 0.82 - 10, 'mem');
    g.appendChild(txt('v-wbmux-sel', C.WB_MUX.x+4, C.WB_MUX.y - 8, 'sig-value active', ''));

    // ── DECODER ───────────────────────────────────────────────────────────────
    makeBox(g, 'DECODER', 'comp-decode', 'Decoder / Control Unit');
    const dSigs = [
        ['wb_mux','v-ctrl-wb'], ['rwe','v-ctrl-rwe'], ['pc_rs1','v-ctrl-pcrs1'],
        ['as1','v-ctrl-as1'],   ['as2','v-ctrl-as2'], ['alu_op','v-ctrl-aop'],
        ['br','v-ctrl-br'],     ['jmp','v-ctrl-jmp'], ['mwe','v-ctrl-mwe'], ['mre','v-ctrl-mre'],
    ];
    const dStartX = C.DECODER.x + 140;  // leave room for title
    const dColW   = (C.DECODER.w - 150) / dSigs.length;
    dSigs.forEach(([name, id], i) => {
        const dx = dStartX + i * dColW;
        const dy = C.DECODER.y;
        g.appendChild(staticTxt(dx, dy + 30, 'sig-name', name));
        g.appendChild(txt(id, dx, dy + 52, 'sig-value active', '0'));
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  WIRES — routing corridors derived from C so layout changes auto-propagate
    // ══════════════════════════════════════════════════════════════════════════
    const leftOfPC4   = C.PC4_ADD.x - 15;              // clear zone left of PC4_ADD
    const topCorr     = C.PC_TGT.y - 18;               // top corridor (branch→nextmux)
    const altTopCorr  = C.PC_TGT.y - 30;               // alt top corridor (pc→muxa)
    const leftOfIMM   = C.IMM_GEN.x - 15;              // left of IMM_GEN
    const rightOfFE   = C.FE.x + C.FE.w + 15;          // right of FE
    const belowRF     = C.RF.y + C.RF.h + 15;          // below RF bottom
    const belowMuxB   = C.MUX_B.y + C.MUX_B.h + 15;   // below MUX_B
    const leftOfMuxAB = C.MUX_B.x - 18;                // left of both muxes (used by wire-dec-muxa)
    const immMuxBCorr = C.MUX_B.x - 50;                // separate corridor for wire-immgen-muxb (avoids overlap with wire-dec-muxa at leftOfMuxAB)
    const rightOfALU  = C.ALU.x + C.ALU.w + 20;        // right of ALU
    const leftOfRF    = C.RF.x - 15;                   // left of RF
    const aluBrMid    = (C.ALU.x + C.ALU.w + C.BRANCH.x) >> 1;  // ALU-BRANCH gap
    const decY        = C.DECODER.y;

    // ── NEXT_MUX → PC ─────────────────────────────────────────────────────────
    g.appendChild(makeWire('wire-nextmux-pc',
        wirePath(pt('NEXT_MUX','r'), pt('PC','l'))));

    // ── PC → IMEM ─────────────────────────────────────────────────────────────
    g.appendChild(makeWire('wire-pc-imem',
        wirePath(pt('PC','r'), pt('IMEM','l'))));

    // ── PC → PC4_ADD (detour left of PC4_ADD, enter from left) ───────────────
    {
        const [px, py] = pt('PC', 'l', 0.3);
        const [ax, ay] = pt('PC4_ADD', 'l');
        g.appendChild(makeWire('wire-pc-pc4',
            `M ${px},${py} H ${leftOfPC4} V ${ay} H ${ax}`));
    }

    // ── PC4_ADD → NEXT_MUX (exit bottom, go left of NEXT_MUX, approach from left)
    // Must NOT come from the right — that last segment would cut through the mux body.
    {
        const [mx, my] = pt('NEXT_MUX', 'l', 0.22);
        const leftX    = C.NEXT_MUX.x - 20;          // corridor left of NEXT_MUX
        const [bx, by] = pt('PC4_ADD', 'b', 0.3);    // exit PC4_ADD bottom (offset from wbmux)
        g.appendChild(makeWire('wire-pc4-nextmux',
            `M ${bx},${by} V ${by + 40} H ${leftX} V ${my} H ${mx}`));
    }

    // ── PC4_ADD → WB_MUX (exit bottom, route left of RF, enter WB_MUX top) ────
    {
        const [ax, ay] = pt('PC4_ADD', 'b', 0.5);
        const [wx, wy] = pt('WB_MUX', 'l', 0.18);
        g.appendChild(makeWire('wire-pc4-wbmux',
            `M ${ax},${ay} V ${ay + 30} H ${leftOfRF} V ${wy} H ${wx}`));
    }

    // ── IMEM → FE ─────────────────────────────────────────────────────────────
    g.appendChild(makeWire('wire-imem-fe',
        wirePath(pt('IMEM','r'), pt('FE','l'))));

    // ── FE → IMM_GEN ──────────────────────────────────────────────────────────
    {
        const [fx, fy] = pt('FE','b',0.5);
        const [ix, iy] = pt('IMM_GEN','t',0.5);
        g.appendChild(makeWire('wire-fe-immgen', wireHV([fx, fy], [ix, iy])));
    }

    // ── IMM_GEN → DECODER (instruction bus; purple, enters DECODER left side) ───
    // Inline style used so the purple color is guaranteed regardless of CSS cache.
    // Route: IMM_GEN bottom → stub → left to clear margin → down to just
    // outside the decoder left edge → rightward into decoder left port.
    {
        const ix     = C.FE.x + C.FE.w * 0.25;
        const iy     = C.FE.y + C.FE.h;
        const [dx, dy] = pt('DECODER', 'l', 0.5);
        const outerX   = dx - 20;   // just left of decoder (x=32), so final H goes rightward
        const belowMux = C.NEXT_MUX.y + C.NEXT_MUX.h + 15;  // clear below NEXT_MUX
        const d = `M ${ix},${iy} V ${belowMux} H ${outerX} V ${dy} H ${dx}`;
        const p = el('path', {
            id: 'wire-fe-dec', d, fill: 'none',
            style: 'stroke:#c084fc;stroke-width:2',
            'marker-end': 'url(#arrow-instr)'
        });
        g.appendChild(p);
    }

    // ── FE → RF (rs1/rs2/rd address lines) ────────────────────────────────────
    {
        const [fx, fy] = pt('FE', 'r', 0.4);
        const [rx, ry] = pt('RF', 'l', 0.4);
        g.appendChild(makeWire('wire-fe-rf', wirePath([fx, fy], [rx, ry])));
    }

    // ── IMM_GEN → PC_TGT (jog right of FE to avoid crossing it) ─────────────
    {
        const [ix, iy] = pt('IMM_GEN', 't', 0.5);
        const [tx, ty] = pt('PC_TGT', 'b', 0.5);
        g.appendChild(makeWire('wire-immgen-pctgt',
            `M ${ix},${iy} V ${iy - 15} H ${rightOfFE} V ${ty + 15} H ${tx} V ${ty}`));
    }

    // ── IMM_GEN → MUX_B (route below RF then come up left of MUX_B) ──────────
    {
        const [ix, iy] = pt('IMM_GEN', 'r');
        const [mx, my] = pt('MUX_B', 'l', 0.78);
        g.appendChild(makeWire('wire-immgen-muxb',
            `M ${ix},${iy} H ${ix + 15} V ${belowRF} H ${immMuxBCorr} V ${my} H ${mx}`));
    }

    // ── PC_TGT → NEXT_MUX (bottom input) ─────────────────────────────────────
    // Output exits PC_TGT TOP (not left — left is for inputs). Stub UP 15px,
    // then use corridor y=57 (between wire-pc-muxa y=42 and wire-branch-nextmux y=54)
    // to route left, then drop to NEXT_MUX.
    {
        const [tx, ty] = pt('PC_TGT', 't', 0.3);   // exit from top of adder
        const [mx, my] = pt('NEXT_MUX', 'l', 0.78);
        const tgtTopCorr = ty - 15;   // stub: 15px above top border
        const leftCorr   = mx - 28;   // corridor left of NEXT_MUX
        g.appendChild(makeWire('wire-pctgt-nextmux',
            `M ${tx},${ty} V ${tgtTopCorr} H ${leftCorr} V ${my} H ${mx}`));
    }

    // ── PC → MUX_TGT (top input: PC for B/JAL; stub UP 15px before horizontal)
    {
        const [px, py] = pt('PC', 't', 0.5);
        const [tx, ty] = pt('MUX_TGT', 'l', 0.22);
        g.appendChild(makeWire('wire-pc-muxtgt',
            `M ${px},${py} V ${py - 15} H ${leftOfPC4 - 8} V ${ty} H ${tx}`));
    }

    // ── RF → MUX_TGT (rs1 data, bottom input: RS1 for JALR target) ───────────
    // Exits RF left side near top (y=289, above FE/IMEM y=330), routes left and up.
    {
        const [rx, ry] = pt('RF', 'l', 0.1);
        const [mx, my] = pt('MUX_TGT', 'l', 0.78);
        g.appendChild(makeWire('wire-rs1-muxtgt',
            `M ${rx},${ry} H ${mx - 15} V ${my} H ${mx}`));
    }

    // ── MUX_TGT → PC_TGT (base address; enter upper-left port frac 0.3) ────────
    g.appendChild(makeWire('wire-muxtgt-pctgt',
        wirePath(pt('MUX_TGT', 'r'), pt('PC_TGT', 'l', 0.3))));

    // ── RF → MUX_A (rs1_data, top input) ─────────────────────────────────────
    {
        const [rx, ry] = pt('RF', 'r', 0.35);
        const [mx, my] = pt('MUX_A', 'l', 0.22);
        g.appendChild(makeWire('wire-rf-muxa', wirePath([rx, ry], [mx, my])));
    }

    // ── RF → MUX_B (rs2_data, top input) ─────────────────────────────────────
    {
        const [rx, ry] = pt('RF', 'r', 0.55);
        const [mx, my] = pt('MUX_B', 'l', 0.22);
        g.appendChild(makeWire('wire-rf-muxb', wirePath([rx, ry], [mx, my])));
    }

    // ── RF → DMEM (store data; drop below MUX_B, right of ALU, up to DMEM) ───
    {
        const [rx, ry] = pt('RF', 'r', 0.68);
        const [dx, dy] = pt('DMEM', 'l', 0.28);
        g.appendChild(makeWire('wire-rf-dmem',
            `M ${rx},${ry} H ${rx + 15} V ${belowMuxB} H ${rightOfALU} V ${dy} H ${dx}`));
    }

    // ── PC → MUX_A (AUIPC; exit PC right, use alt top corridor above topCorr) ─
    {
        const [px, py] = pt('PC', 'r', 0.5);
        const [mx, my] = pt('MUX_A', 'l', 0.78);
        const rightCorr = C.IMEM.x - 20;
        g.appendChild(makeWire('wire-pc-muxa',
            `M ${px},${py} H ${rightCorr} V ${altTopCorr} H ${mx - 22} V ${my} H ${mx}`));
    }

    // ── MUX_A → ALU ───────────────────────────────────────────────────────────
    {
        const [mx, my] = pt('MUX_A', 'r');
        const [ax, ay] = pt('ALU', 'l', 0.28);
        g.appendChild(makeWire('wire-muxa-alu', wirePath([mx, my], [ax, ay])));
    }

    // ── MUX_B → ALU ───────────────────────────────────────────────────────────
    {
        const [mx, my] = pt('MUX_B', 'r');
        const [ax, ay] = pt('ALU', 'l', 0.72);
        g.appendChild(makeWire('wire-muxb-alu', wirePath([mx, my], [ax, ay])));
    }

    // ── ALU → BRANCH LOGIC (exit ALU top-right corner, route through gap) ─────
    {
        const [bx, by] = pt('BRANCH', 'l', 0.5);
        g.appendChild(makeWire('wire-alu-branch',
            `M ${C.ALU.x + C.ALU.w},${C.ALU.y} V ${C.ALU.y - 15} H ${aluBrMid} V ${by} H ${bx}`));
    }

    // ── ALU → DMEM (address) ──────────────────────────────────────────────────
    // Default midX (≈1740) would pass through BRANCH (x=1647-1832). Use rightOfBranch instead.
    {
        const [ax, ay] = pt('ALU', 'r', 0.3);
        const [dx, dy] = pt('DMEM', 'l', 0.15);
        const rightOfBranch = C.BRANCH.x + C.BRANCH.w + 15;  // 1847
        g.appendChild(makeWire('wire-alu-dmem', wirePath([ax, ay], [dx, dy], rightOfBranch)));
    }

    // ── ALU → WB_MUX (middle input)
    // Route BELOW WB_MUX then approach from LEFT so arrow points right into the input port.
    // Corridor: x = WB_MUX.x − 15, y = WB_MUX.y + WB_MUX.h + 12
    {
        const [ax, ay] = pt('ALU', 'b', 0.35);
        const [wx, wy] = pt('WB_MUX', 'l', 0.5);
        const belowWB  = C.WB_MUX.y + C.WB_MUX.h + 12;  // 1020
        const leftCorr = C.WB_MUX.x - 15;                // 925
        g.appendChild(makeWire('wire-alu-wbmux',
            `M ${ax},${ay} V ${belowWB} H ${leftCorr} V ${wy} H ${wx}`));
    }

    // ── DMEM → WB_MUX (mem read data)
    // Route BELOW WB_MUX then approach from LEFT so arrow points right into the input port.
    // Different y/x corridors from wire-alu-wbmux to avoid overlap.
    {
        const [dx, dy] = pt('DMEM', 'r', 0.7);
        const [wx, wy] = pt('WB_MUX', 'l', 0.82);
        const belowWB  = C.WB_MUX.y + C.WB_MUX.h + 22;  // 1030
        const leftCorr = C.WB_MUX.x - 25;                // 915
        g.appendChild(makeWire('wire-dmem-wbmux',
            `M ${dx},${dy} H ${dx + 15} V ${belowWB} H ${leftCorr} V ${wy} H ${wx}`));
    }

    // ── BRANCH → NEXT_MUX (pc_src ctrl; top corridor, then approach from BOTTOM)
    // Uses a DIFFERENT left-side corridor (x = NEXT_MUX.x − 36) than pc4-nextmux
    // (x = NEXT_MUX.x − 20) so the two wires don't share the same vertical segment.
    {
        const [bx, by] = pt('BRANCH', 't', 0.3);
        const [nx, ny] = pt('NEXT_MUX', 'b', 0.5);
        const ctrlX  = C.NEXT_MUX.x - 36;   // ctrl corridor — further left than data wires
        const belowY = ny + 20;
        g.appendChild(makeWire('wire-branch-nextmux',
            `M ${bx},${by} V ${topCorr} H ${ctrlX} V ${belowY} H ${nx} V ${ny}`, 'wire-ctrl'));
    }

    // ── WB_MUX → RF (writeback; exit WB_MUX right, up to RF bottom center) ────
    {
        const [wx, wy] = pt('WB_MUX', 'r');
        const [rx, ry] = pt('RF', 'b', 0.5);
        g.appendChild(makeWire('wire-wbmux-rf', `M ${wx},${wy} H ${rx} V ${ry}`));
    }

    // ── DECODER → components (ctrl wires: start decoder top, end at component
    //    bottom so arrow points UP into the component) ──────────────────────────
    const ctrlTargets = [
        { id:'wire-dec-rf',     tx: C.RF.x     + 20,              ty: pt('RF',     'b')[1] },
        { id:'wire-dec-muxb',   tx: C.MUX_B.x  + C.MUX_B.w  / 2, ty: pt('MUX_B',  'b')[1] },
        { id:'wire-dec-alu',    tx: C.ALU.x    + C.ALU.w    / 2,  ty: pt('ALU',    'b')[1] },
        { id:'wire-dec-branch', tx: C.BRANCH.x + C.BRANCH.w * 0.35, ty: pt('BRANCH', 'b')[1] },
        { id:'wire-dec-jump',   tx: C.BRANCH.x + C.BRANCH.w * 0.65, ty: pt('BRANCH', 'b')[1] },
        { id:'wire-dec-dmem-we', tx: C.DMEM.x + C.DMEM.w * 0.35, ty: pt('DMEM', 'b')[1] },
        { id:'wire-dec-dmem-re', tx: C.DMEM.x + C.DMEM.w * 0.65, ty: pt('DMEM', 'b')[1] },
        { id:'wire-dec-wbmux',  tx: C.WB_MUX.x + C.WB_MUX.w / 2, ty: pt('WB_MUX', 'b')[1] },
    ];
    ctrlTargets.forEach(({ id, tx, ty }) => {
        g.appendChild(makeWire(id, `M ${tx},${decY} V ${ty}`, 'wire-ctrl'));
    });

    // wire-dec-muxtgt: MUX_TGT is above IMEM, so detour left of IMEM to reach it.
    {
        const tx = C.MUX_TGT.x + C.MUX_TGT.w / 2;   // 516
        const ty = C.MUX_TGT.y + C.MUX_TGT.h;        // 200
        const detourX = C.IMEM.x - 25;                // 355, left of IMEM
        const belowIMEM = C.IMEM.y + C.IMEM.h + 15;  // 520
        g.appendChild(makeWire('wire-dec-muxtgt',
            `M ${tx},${decY} V ${belowIMEM} H ${detourX} V ${ty + 15} H ${tx} V ${ty}`, 'wire-ctrl'));
    }

    // wire-dec-muxa: MUX_A is directly above MUX_B (same x band), so detour left.
    // Start 8px RIGHT of wire-dec-muxb's x so the two don't share the initial vertical.
    {
        const centerX = C.MUX_A.x + C.MUX_A.w / 2;
        const startX  = centerX + 8;   // offset so it doesn't overlap wire-dec-muxb
        const ty = pt('MUX_A', 'b')[1];
        g.appendChild(makeWire('wire-dec-muxa',
            `M ${startX},${decY} V ${belowMuxB + 15} H ${leftOfMuxAB} V ${ty} H ${centerX}`,
            'wire-ctrl'));
    }

    // ── WIRE VALUE LABELS ─────────────────────────────────────────────────────
    // wireLabel places text ABOVE the wire — pass the wire's y coordinate directly.

    // pc  ── wire-pc-imem: horizontal between PC and IMEM
    wireLabel(g, 'wl-pc',
        C.PC.x + C.PC.w + 18,  C.PC.y + C.PC.h * 0.5);

    // pc_next ── wire-nextmux-pc: horizontal between NEXT_MUX and PC
    wireLabel(g, 'wl-pcnext',
        C.NEXT_MUX.x + C.NEXT_MUX.w + 6,  C.NEXT_MUX.y + C.NEXT_MUX.h * 0.5);

    // instr ── wire-imem-fe: horizontal between IMEM and FE
    wireLabel(g, 'wl-instr',
        C.IMEM.x + C.IMEM.w + 6,  C.IMEM.y + C.IMEM.h * 0.5);

    // imm ── wire-immgen-muxb: horizontal approaching MUX_B bottom input
    wireLabel(g, 'wl-imm',
        C.MUX_B.x - 96,  C.MUX_B.y + C.MUX_B.h * 0.78);

    // rs1_data ── wire-rf-muxa: horizontal approaching MUX_A top input
    wireLabel(g, 'wl-rs1d',
        C.MUX_A.x - 96,  C.MUX_A.y + C.MUX_A.h * 0.22);

    // rs2_data ── wire-rf-muxb: horizontal approaching MUX_B top input
    wireLabel(g, 'wl-rs2d',
        C.MUX_B.x - 96,  C.MUX_B.y + C.MUX_B.h * 0.22);

    // rs1 (to target) ── wire-rs1-muxtgt: horizontal at y=289 from RF to MUX_TGT
    wireLabel(g, 'wl-rs1-tgt',
        (C.RF.x + C.MUX_TGT.x) / 2 - 20,  C.RF.y + C.RF.h * 0.1);

    // wdata ── wire-rf-dmem: horizontal below MUX_B going right toward DMEM
    wireLabel(g, 'wl-wdata',
        C.ALU.x - 120,  C.MUX_B.y + C.MUX_B.h + 15);

    // alu_a ── wire-muxa-alu: horizontal approaching ALU input A
    wireLabel(g, 'wl-alua',
        C.ALU.x - 96,  C.ALU.y + C.ALU.h * 0.28);

    // alu_b ── wire-muxb-alu: horizontal approaching ALU input B
    wireLabel(g, 'wl-alub',
        C.ALU.x - 96,  C.ALU.y + C.ALU.h * 0.72);

    // alu_result ── wire-alu-dmem / wire-alu-branch / wire-alu-wbmux: right of ALU
    wireLabel(g, 'wl-alur',
        C.ALU.x + C.ALU.w + 6,  C.ALU.y + C.ALU.h * 0.3);

    // dmem_rdata ── wire-dmem-wbmux: exits DMEM right side
    wireLabel(g, 'wl-dmrd',
        C.DMEM.x + C.DMEM.w + 6,  C.DMEM.y + C.DMEM.h * 0.7);

    // wb_data ── wire-wbmux-rf: vertical segment right of WB_MUX going up to RF
    wireLabel(g, 'wl-wb',
        C.WB_MUX.x + C.WB_MUX.w + 6,  C.WB_MUX.y + 10);

    // pc_target ── wire-pctgt-nextmux: vertical left corridor going to NEXT_MUX bottom
    wireLabel(g, 'wl-pctgt',
        C.NEXT_MUX.x + C.NEXT_MUX.w + 6,  C.NEXT_MUX.y + C.NEXT_MUX.h * 0.78);

    // pc_plus4 ── wire-pc4-nextmux: vertical left corridor going to NEXT_MUX top
    wireLabel(g, 'wl-pc4',
        C.NEXT_MUX.x + C.NEXT_MUX.w + 6,  C.NEXT_MUX.y + C.NEXT_MUX.h * 0.22);

    // ── Bring all text + label bg-rects to front (SVG painter model: last = on top)
    // This ensures every label renders above wires regardless of creation order.
    Array.from(g.querySelectorAll('text, rect.wire-label-bg'))
         .forEach(node => g.appendChild(node));
}

// ════════════════════════════════════════════════════════════════════════════════
//  Helpers for updateDatapath
// ════════════════════════════════════════════════════════════════════════════════

function set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setWire(id, active, typeOrCtrl = false) {
    const el = document.getElementById(id);
    if (!el) return;
    const type = typeOrCtrl === true ? 'ctrl' : typeOrCtrl === false ? 'data' : typeOrCtrl;
    const base = `wire-${type}`;
    el.setAttribute('class', active ? base : `${base} inactive`);
    const markerType = active ? type : 'inactive';
    el.setAttribute('marker-end', `url(#arrow-${markerType})`);
}

function setWireLabel(id, text) {
    const t  = document.getElementById(id);
    const bg = document.getElementById(id + '-bg');
    if (!t) return;
    t.textContent = text;
    if (bg) {
        if (text) {
            bg.setAttribute('visibility', 'visible');
            bg.setAttribute('width', Math.max(30, text.length * 6.5 + 6));
        } else {
            bg.setAttribute('visibility', 'hidden');
        }
    }
}

function setRegBox(i, cls) {
    const b = document.getElementById(`reg-box-${i}`);
    if (b) b.setAttribute('class', `reg-box ${cls}`);
}

// Format a 32-bit value
function fmtV(v, fmt) {
    const u = v >>> 0;
    if (fmt === 'hex') return '0x' + u.toString(16).toUpperCase().padStart(8, '0');
    return u.toString(10);
}

// Short hex (no leading zeros beyond minimum)
function fmtShort(v, fmt) {
    const u = v >>> 0;
    if (fmt === 'hex') return '0x' + u.toString(16).toUpperCase();
    return (v | 0).toString(10);
}

// Decode opcode to instruction type string
function instrType(opcode) {
    switch(opcode) {
        case 0x33: return 'R-Type';
        case 0x13: return 'I-Type';
        case 0x03: return 'I-Type (Load)';
        case 0x23: return 'S-Type';
        case 0x63: return 'B-Type';
        case 0x37: return 'U-Type (LUI)';
        case 0x17: return 'U-Type (AUIPC)';
        case 0x6F: return 'J-Type (JAL)';
        case 0x67: return 'I-Type (JALR)';
        case 0x73: return 'System';
        default:   return 'Unknown';
    }
}

// Disassemble a snapshot back to a readable mnemonic string (for the top bar)
function disasm(snap) {
    const { opcode, rd, rs1, rs2, funct3, funct7, imm, ctrl } = snap;
    const R  = n => `x${n}`;
    const im = (imm | 0).toString(10);
    switch(opcode) {
        case 0x33: {
            const ops = { 0:['ADD','SUB'], 1:['SLL'], 2:['SLT'], 3:['SLTU'],
                          4:['XOR'], 5:['SRL','SRA'], 6:['OR'], 7:['AND'] };
            const pair = ops[funct3] || ['?'];
            const nm = (funct3===0||funct3===5) ? (funct7===0x20 ? pair[1] : pair[0]) : pair[0];
            return `${nm} ${R(rd)}, ${R(rs1)}, ${R(rs2)}`;
        }
        case 0x13: {
            const nm = {0:'ADDI',1:'SLLI',2:'SLTI',3:'SLTIU',4:'XORI',5:funct7===0x20?'SRAI':'SRLI',6:'ORI',7:'ANDI'}[funct3]||'?';
            return `${nm} ${R(rd)}, ${R(rs1)}, ${im}`;
        }
        case 0x03: {
            const nm = {0:'LB',1:'LH',2:'LW',4:'LBU',5:'LHU'}[funct3]||'?';
            return `${nm} ${R(rd)}, ${im}(${R(rs1)})`;
        }
        case 0x23: {
            const nm = {0:'SB',1:'SH',2:'SW'}[funct3]||'?';
            return `${nm} ${R(rs2)}, ${im}(${R(rs1)})`;
        }
        case 0x63: {
            const nm = {0:'BEQ',1:'BNE',4:'BLT',5:'BGE',6:'BLTU',7:'BGEU'}[funct3]||'?';
            return `${nm} ${R(rs1)}, ${R(rs2)}, ${im}`;
        }
        case 0x37: return `LUI ${R(rd)}, ${((imm>>>0)>>>12).toString(10)}`;
        case 0x17: return `AUIPC ${R(rd)}, ${((imm>>>0)>>>12).toString(10)}`;
        case 0x6F: return `JAL ${R(rd)}, ${im}`;
        case 0x67: return `JALR ${R(rd)}, ${R(rs1)}, ${im}`;
        case 0x73: return snap.instr === 0x00100073 ? 'EBREAK' : 'ECALL';
        default:   return `0x${(snap.instr>>>0).toString(16).toUpperCase().padStart(8,'0')}`;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
//  updateDatapath — called every step with a fresh cpu.js snapshot
// ════════════════════════════════════════════════════════════════════════════════
export function updateDatapath(snap, fmt) {
    if (!snap) return;
    const { ctrl, regs, opcode } = snap;

    // ── Top bar signals ────────────────────────────────────────────────────────
    const mnemonic = disasm(snap);
    const type     = instrType(opcode);
    // (main.js reads these back from snap for the top bar — see main.js)

    // ── PC box ────────────────────────────────────────────────────────────────
    set('v-pc',     fmtV(snap.pc,      fmt));
    set('v-pcnext', fmtV(snap.pc_next, fmt));

    // ── PC+4 adder ────────────────────────────────────────────────────────────
    set('v-pc4', fmtV(snap.pc_plus4, fmt));

    // ── PC target adder ───────────────────────────────────────────────────────
    set('v-pctgt', fmtV(snap.pc_target, fmt));

    // ── IMEM ─────────────────────────────────────────────────────────────────
    set('v-imem-addr', fmtV(snap.pc, fmt));
    set('v-instr', '0x' + (snap.instr>>>0).toString(16).toUpperCase().padStart(8,'0'));
    set('v-asm',   mnemonic);

    // ── Field extractor ───────────────────────────────────────────────────────
    set('v-opcode', '0x' + snap.opcode.toString(16).toUpperCase().padStart(2,'0'));
    set('v-rd',  `x${snap.rd}`);
    set('v-rs1', `x${snap.rs1}`);
    set('v-rs2', `x${snap.rs2}`);
    set('v-f3',  '0x' + snap.funct3.toString(16).toUpperCase());
    set('v-f7',  '0x' + snap.funct7.toString(16).toUpperCase().padStart(2,'0'));

    // ── Imm gen ───────────────────────────────────────────────────────────────
    set('v-imm',   (snap.imm | 0).toString(10));
    set('v-imm-h', '0x' + (snap.imm>>>0).toString(16).toUpperCase());

    // ── ALU ───────────────────────────────────────────────────────────────────
    set('v-alua',  fmtV(snap.alu_a, fmt));
    set('v-alub',  fmtV(snap.alu_b, fmt));
    set('v-aluop', ALU_NAMES[ctrl.alu_op] || '?');
    set('v-alur',  fmtV(snap.alu_result, fmt));
    set('v-aluz',  snap.alu_zero ? '1' : '0');

    // ── Branch logic ──────────────────────────────────────────────────────────
    set('v-bl-f3',  '0x' + snap.funct3.toString(16));
    set('v-bl-br',  ctrl.branch.toString());
    set('v-bl-jmp', ctrl.jump.toString());
    set('v-pcsrc',  snap.pc_src.toString());

    // ── Data memory ───────────────────────────────────────────────────────────
    set('v-dmem-addr',  fmtV(snap.alu_result, fmt));
    set('v-dmem-wdata', fmtV(snap.rs2_data,   fmt));
    set('v-dmem-we',    ctrl.dmem_wr_en.toString());
    set('v-dmem-re',    ctrl.dmem_rd_en.toString());
    set('v-dmem-f3',    '0x' + snap.funct3.toString(16));
    set('v-dmrd',       fmtV(snap.dmem_rdata, fmt));

    // ── Mux selectors ────────────────────────────────────────────────────────
    set('v-muxa-sel',    ctrl.alu_src_mux_1 ? '1→pc' : '0→rs1');
    set('v-muxb-sel',    ctrl.alu_src_mux_2 ? '1→imm' : '0→rs2');
    set('v-muxtgt-sel',  ctrl.PC_or_Rs1_mux ? '1→rs1' : '0→pc');
    set('v-wbmux-sel',   ['00→pc+4','01→alu','10→mem'][ctrl.writeback_mux] || '?');
    set('v-nextmux-sel', snap.pc_src ? '1→tgt' : '0→+4');

    // ── Decoder signals ───────────────────────────────────────────────────────
    set('v-ctrl-wb',    ctrl.writeback_mux.toString(2).padStart(2,'0'));
    set('v-ctrl-rwe',   ctrl.reg_write_en.toString());
    set('v-ctrl-pcrs1', ctrl.PC_or_Rs1_mux.toString());
    set('v-ctrl-as1',   ctrl.alu_src_mux_1.toString());
    set('v-ctrl-as2',   ctrl.alu_src_mux_2.toString());
    set('v-ctrl-aop',   ALU_NAMES[ctrl.alu_op] || ctrl.alu_op);
    set('v-ctrl-br',    ctrl.branch.toString());
    set('v-ctrl-jmp',   ctrl.jump.toString());
    set('v-ctrl-mwe',   ctrl.dmem_wr_en.toString());
    set('v-ctrl-mre',   ctrl.dmem_rd_en.toString());

    // ── Register file ────────────────────────────────────────────────────────
    for (let i = 0; i < 32; i++) {
        const v = (regs[i] >>> 0);
        const t = document.getElementById(`reg-val-${i}`);
        if (t) {
            const display = fmt === 'hex'
                ? v.toString(16).toUpperCase().padStart(8,'0')
                : v.toString(10).padStart(10,' ');
            t.textContent = display;
        }
        // highlight state
        let cls = '';
        if (i === snap.rd  && ctrl.reg_write_en && snap.rd  !== 0) cls = 'rd';
        else if (i === snap.rs1 && snap.rs1 !== 0)                  cls = 'rs1';
        else if (i === snap.rs2 && snap.rs2 !== 0)                  cls = 'rs2';
        setRegBox(i, cls);
    }

    // ── Wire labels ──────────────────────────────────────────────────────────
    setWireLabel('wl-pc',      fmtShort(snap.pc,          fmt));
    setWireLabel('wl-pcnext',  fmtShort(snap.pc_next,     fmt));
    setWireLabel('wl-instr',   '0x'+(snap.instr>>>0).toString(16).toUpperCase());
    setWireLabel('wl-imm',     fmtShort(snap.imm,         fmt));
    setWireLabel('wl-rs1d',    fmtShort(snap.rs1_data,    fmt));
    setWireLabel('wl-rs2d',    fmtShort(snap.rs2_data,    fmt));
    setWireLabel('wl-rs1-tgt', fmtShort(snap.rs1_data,    fmt));
    setWireLabel('wl-wdata',   fmtShort(snap.rs2_data,    fmt));
    setWireLabel('wl-alua',    fmtShort(snap.alu_a,       fmt));
    setWireLabel('wl-alub',    fmtShort(snap.alu_b,       fmt));
    setWireLabel('wl-alur',    fmtShort(snap.alu_result,  fmt));
    setWireLabel('wl-dmrd',    fmtShort(snap.dmem_rdata,  fmt));
    setWireLabel('wl-wb',      fmtShort(snap.wb_data,     fmt));
    setWireLabel('wl-pctgt',   fmtShort(snap.pc_target,   fmt));
    setWireLabel('wl-pc4',     fmtShort(snap.pc_plus4,    fmt));

    // ── Wire active / inactive coloring ──────────────────────────────────────
    const taken = snap.pc_src === 1;
    const rtype = opcode === 0x33;
    const isLoad  = ctrl.dmem_rd_en  === 1;
    const isStore = ctrl.dmem_wr_en  === 1;
    const isMem   = isLoad || isStore;
    const isJump  = ctrl.jump  === 1;
    const isBranch= ctrl.branch === 1;

    // data wires
    setWire('wire-nextmux-pc',  true);
    setWire('wire-pc-imem',     true);
    setWire('wire-imem-fe',     true);
    setWire('wire-fe-immgen',   true);
    setWire('wire-fe-rf',       true);
    setWire('wire-pc-pc4',      true);
    setWire('wire-pc4-nextmux', !taken);          // active when NOT branching/jumping
    setWire('wire-pc4-wbmux',   ctrl.writeback_mux === 0b00);  // JAL/JALR
    setWire('wire-immgen-pctgt',isBranch || isJump);
    setWire('wire-immgen-muxb', ctrl.alu_src_mux_2 === 1);
    setWire('wire-pc-muxtgt',   (isBranch || isJump) && ctrl.PC_or_Rs1_mux === 0);
    setWire('wire-rs1-muxtgt',  ctrl.PC_or_Rs1_mux === 1);
    setWire('wire-muxtgt-pctgt',isBranch || isJump);
    setWire('wire-pc-muxa',     ctrl.alu_src_mux_1 === 1);    // AUIPC
    setWire('wire-pctgt-nextmux', taken);
    setWire('wire-rf-muxa',     ctrl.alu_src_mux_1 === 0);    // normal ALU ops
    setWire('wire-rf-muxb',     ctrl.alu_src_mux_2 === 0);    // R-type
    setWire('wire-rf-dmem',     isStore);
    setWire('wire-muxa-alu',    true);
    setWire('wire-muxb-alu',    true);
    setWire('wire-alu-branch',  isBranch || isJump);
    setWire('wire-alu-dmem',    isMem);
    setWire('wire-alu-wbmux',   ctrl.writeback_mux === 0b01);  // ALU result writeback
    setWire('wire-dmem-wbmux',  isLoad);
    setWire('wire-wbmux-rf',    ctrl.reg_write_en === 1);

    // control wires
    setWire('wire-fe-dec',    true,  'instr');
    setWire('wire-branch-nextmux', isBranch || isJump, true);
    setWire('wire-dec-rf',    ctrl.reg_write_en === 1, true);
    setWire('wire-dec-muxa',   true, true);
    setWire('wire-dec-muxb',   true, true);
    setWire('wire-dec-muxtgt', true, true);
    setWire('wire-dec-branch', isBranch, true);
    setWire('wire-dec-jump',   isJump,   true);
    setWire('wire-dec-alu',   true, true);
    setWire('wire-dec-dmem-we', isStore, true);
    setWire('wire-dec-dmem-re', isLoad,  true);
    setWire('wire-dec-wbmux', true, true);

    // return the mnemonic and type so main.js can display them in the top bar
    return { mnemonic, type };
}
