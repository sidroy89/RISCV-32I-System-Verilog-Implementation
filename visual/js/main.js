'use strict';

import { CPU }                         from './cpu.js';
import { assemble, TEXT_BASE }         from './assembler.js';
import { buildDatapath, updateDatapath } from './datapath.js';

// ── Example programs ──────────────────────────────────────────────────────────
const EXAMPLES = {
    alu: `# ALU Operations
# Demonstrates R-type and I-type arithmetic

    addi x1, x0, 10      # x1 = 10
    addi x2, x0, 20      # x2 = 20
    add  x3, x1, x2      # x3 = 30
    sub  x4, x2, x1      # x4 = 10
    and  x5, x3, x4      # x5 = 10 AND 10 = 10
    or   x6, x1, x2      # x6 = 10 OR  20 = 30
    xor  x7, x1, x2      # x7 = 10 XOR 20 = 30
    slli x8, x1, 2       # x8 = 10 << 2 = 40
    srli x9, x8, 1       # x9 = 40 >> 1 = 20
    slt  x10, x1, x2     # x10 = 1  (10 < 20 is true)
    ecall`,

    branch: `# Branch and Loop
# Sums 1+2+3+4+5 = 15 using a loop

    addi x1, x0, 0       # x1 = counter = 0
    addi x2, x0, 5       # x2 = limit   = 5
    addi x3, x0, 0       # x3 = sum     = 0
loop:
    addi x1, x1, 1       # counter++
    add  x3, x3, x1      # sum += counter
    blt  x1, x2, loop    # if counter < limit, keep going
    ecall                 # done: x1=5, x3=15`,

    load: `# Load from Memory
# Reads two values from the .data section

.data
    .word 42
    .word 100

.text
    lui  x1, 0x80002     # x1 = 0x80002000  (data base address)
    lw   x2, 0(x1)       # x2 = 42
    lw   x3, 4(x1)       # x3 = 100
    add  x4, x2, x3      # x4 = 142
    ecall`,

    store: `# Store to Memory
# Writes values to memory then reads them back

    addi x1, x0, 42      # x1 = 42
    addi x2, x0, 100     # x2 = 100
    lui  x3, 0x80002     # x3 = 0x80002000  (data base address)
    sw   x1, 0(x3)       # mem[0x80002000] = 42
    sw   x2, 4(x3)       # mem[0x80002004] = 100
    lw   x4, 0(x3)       # x4 = 42   (verify store)
    lw   x5, 4(x3)       # x5 = 100  (verify store)
    ecall`,
};

// ── Datapath bounding box (SVG units) — used for fit-to-screen ───────────────
const DATAPATH_BOUNDS = { x: 40, y: 55, w: 2240, h: 1180 };

// ── State ─────────────────────────────────────────────────────────────────────
let cpu            = new CPU();
let snapHistory    = [];          // parallel to cpu.history — stores signal snapshots
let cycleCount     = 0;
let programLoaded  = false;
let fmt            = 'hex';       // 'hex' | 'dec'
let darkMode       = true;
let playTimer      = null;        // setInterval handle when playing
let transform      = { tx: 60, ty: 50, scale: 0.62 };  // initial pan/zoom
let errorMarkers   = [];          // CodeMirror line widgets for errors
let editor         = null;        // CodeMirror instance

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const svgEl     = $('datapath-svg');
const viewport  = $('viewport');

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    buildDatapath(viewport);
    applyTransform();
    initEditor();
    initControls();
    initPanZoom();
    initZoomButtons();
    initInfoModal();
    updateControlStates();
    // Load the ALU example by default
    loadExample('alu');
});

// ── Info modal ────────────────────────────────────────────────────────────────
function initInfoModal() {
    const overlay = $('info-overlay');
    if (!overlay) return;
    const show = () => overlay.classList.add('open');
    const hide = () => overlay.classList.remove('open');
    $('btn-info').addEventListener('click', show);
    $('info-modal-close').addEventListener('click', hide);
    overlay.addEventListener('click', e => { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}

// ── CodeMirror editor ─────────────────────────────────────────────────────────
function initEditor() {
    const textarea = $('editor');
    if (typeof CodeMirror === 'undefined') {
        // No internet — fall back to plain textarea
        editor = {
            getValue:    ()  => textarea.value,
            setValue:    (v) => { textarea.value = v; },
            addLineClass:     () => {},
            removeLineClass:  () => {},
            getAllMarks:  ()  => [],
        };
        return;
    }
    editor = CodeMirror.fromTextArea(textarea, {
        mode:          'text/x-gas',
        theme:         'default',
        lineNumbers:   true,
        indentWithTabs:false,
        tabSize:       4,
        lineWrapping:  false,
        autofocus:     false,
        extraKeys: {
            'Ctrl-Enter': doAssemble,
            'Cmd-Enter':  doAssemble,
        },
    });
    // Make the editor fill its container
    editor.setSize('100%', '100%');
}

function clearEditorErrors() {
    errorMarkers.forEach(({ line, mark }) => {
        editor.removeLineClass(line, 'background', 'cm-error-line');
        if (mark && mark.clear) mark.clear();
    });
    errorMarkers = [];
}

function markEditorErrors(errors) {
    clearEditorErrors();
    errors.forEach(({ line, message }) => {
        if (line == null) return;
        editor.addLineClass(line, 'background', 'cm-error-line');
        errorMarkers.push({ line });
    });
}

// ── Assemble & Load ──────────────────────────────────────────────────────────
function doAssemble() {
    const source = editor.getValue();
    const result = assemble(source);

    clearEditorErrors();
    $('error-panel').classList.add('hidden');
    $('error-list').innerHTML = '';

    if (!result.success) {
        showErrors(result.errors);
        markEditorErrors(result.errors);
        return;
    }

    // Load into CPU
    cpu = new CPU();
    cpu.loadProgram(result.words);
    if (result.dataBytes.length > 0) {
        cpu.loadData(result.dataBytes, result.dataOffset);
    }

    snapHistory   = [];
    cycleCount    = 0;
    programLoaded = true;
    pausePlay();

    updateTopBar(null, 'Program loaded — press Step or Play', '', '');
    $('cycle-counter').textContent = 'Cycle: 0';
    updateControlStates();
}

function showErrors(errors) {
    const panel = $('error-panel');
    const list  = $('error-list');
    panel.classList.remove('hidden');
    list.innerHTML = '';
    errors.forEach(({ line, message }) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="err-line">L${line + 1}</span>${escHtml(message)}`;
        li.addEventListener('click', () => {
            if (editor.setCursor) editor.setCursor(line, 0);
            if (editor.focus)     editor.focus();
        });
        list.appendChild(li);
    });
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Step / StepBack / Reset / Play / Pause ───────────────────────────────────
function doStep() {
    if (!programLoaded || cpu.halted) return;
    const snap = cpu.step();
    if (!snap) return;

    snapHistory.push(snap);
    cycleCount++;

    const { mnemonic, type } = updateDatapath(snap, fmt);
    updateTopBar(snap, mnemonic, type, '0x' + (snap.pc >>> 0).toString(16).toUpperCase().padStart(8,'0'));
    $('cycle-counter').textContent = `Cycle: ${cycleCount}`;
    updateControlStates();

    if (snap.halted) {
        pausePlay();
        showModal(snap);
    }
}

function doStepBack() {
    if (snapHistory.length === 0) return;
    pausePlay();
    cpu.stepBack();
    snapHistory.pop();
    cycleCount = Math.max(0, cycleCount - 1);

    if (snapHistory.length > 0) {
        const snap = snapHistory[snapHistory.length - 1];
        const { mnemonic, type } = updateDatapath(snap, fmt);
        updateTopBar(snap, mnemonic, type, '0x' + (snap.pc >>> 0).toString(16).toUpperCase().padStart(8,'0'));
    } else {
        updateTopBar(null, 'Beginning of program', '', '');
    }
    $('cycle-counter').textContent = `Cycle: ${cycleCount}`;
    updateControlStates();
}

function doReset() {
    pausePlay();
    cpu.reset();
    snapHistory  = [];
    cycleCount   = 0;
    updateTopBar(null, 'Reset — press Step or Play', '', '');
    $('cycle-counter').textContent = 'Cycle: 0';
    updateControlStates();
}

function doPlay() {
    if (playTimer) return;
    $('btn-play').style.display  = 'none';
    $('btn-pause').style.display = '';
    playTimer = setInterval(() => {
        if (cpu.halted || !programLoaded) { pausePlay(); return; }
        doStep();
    }, 3000);   // 1 cycle per 3 seconds
}

function pausePlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    $('btn-play').style.display  = '';
    $('btn-pause').style.display = 'none';
}

// ── Top bar update ────────────────────────────────────────────────────────────
function updateTopBar(snap, mnemonic, type, pcStr) {
    $('cycle-label').textContent    = snap ? `Cycle ${cycleCount}` : 'Cycle 0';
    $('instr-mnemonic').textContent = mnemonic || '';
    $('instr-type').textContent     = type     || '';
    $('pc-display').textContent     = pcStr    || '';
}

// ── Button enabled/disabled state ────────────────────────────────────────────
function updateControlStates() {
    const loaded  = programLoaded;
    const halted  = cpu.halted;
    const hasHist = snapHistory.length > 0;

    $('btn-step-back').disabled = !hasHist;
    $('btn-reset').disabled     = !hasHist && !loaded;
    $('btn-step').disabled      = !loaded || halted;
    $('btn-play').disabled      = !loaded || halted;
    $('btn-pause').disabled     = false;
}

// ── Format toggle (hex / dec) ─────────────────────────────────────────────────
function toggleFormat() {
    fmt = fmt === 'hex' ? 'dec' : 'hex';
    $('btn-format').textContent = fmt === 'hex' ? 'HEX' : 'DEC';
    // Re-render the last snapshot with the new format
    if (snapHistory.length > 0) {
        updateDatapath(snapHistory[snapHistory.length - 1], fmt);
    }
}

// ── Theme toggle (dark / light) ───────────────────────────────────────────────
function toggleTheme() {
    darkMode = !darkMode;
    document.body.className = darkMode ? 'dark' : 'light';
    $('btn-theme').textContent = darkMode ? '☽' : '☀';
}

// ── Load example program ──────────────────────────────────────────────────────
function loadExample(key) {
    if (!EXAMPLES[key]) return;
    clearEditorErrors();
    $('error-panel').classList.add('hidden');
    editor.setValue(EXAMPLES[key]);
    doAssemble();
}

// ── Program-ended modal ───────────────────────────────────────────────────────
function showModal(snap) {
    const a0 = snap.regs[10] >>> 0;
    $('modal-msg').textContent =
        `Program ended at cycle ${cycleCount}. ` +
        (a0 === 0 ? 'a0 (x10) = 0 — PASS ✓' : `a0 (x10) = ${a0} — FAIL ✗`);

    const grid = $('modal-reg-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 32; i++) {
        const v   = snap.regs[i] >>> 0;
        const div = document.createElement('div');
        div.className = 'modal-reg-cell';
        div.innerHTML = `<span class="mreg-name">x${i}</span>
                         <span class="mreg-val">${v.toString(16).toUpperCase().padStart(8,'0')}</span>`;
        grid.appendChild(div);
    }
    $('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    $('modal-overlay').classList.add('hidden');
}

// ── Pan + zoom ────────────────────────────────────────────────────────────────
function applyTransform() {
    // Clamp pan so at least 150px of the diagram always stays on screen
    const rect   = svgEl.getBoundingClientRect();
    const margin = 150;
    const s      = transform.scale;
    const db     = DATAPATH_BOUNDS;
    transform.tx = Math.max(margin - (db.x + db.w) * s,
                   Math.min(rect.width  - margin - db.x * s, transform.tx));
    transform.ty = Math.max(margin - (db.y + db.h) * s,
                   Math.min(rect.height - margin - db.y * s, transform.ty));
    const { tx, ty, scale } = transform;
    viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
}

function initPanZoom() {
    let dragging  = false;
    let dragStart = { x: 0, y: 0, tx: 0, ty: 0 };

    svgEl.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        dragging  = true;
        dragStart = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
        e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        transform.tx = dragStart.tx + (e.clientX - dragStart.x);
        transform.ty = dragStart.ty + (e.clientY - dragStart.y);
        applyTransform();
    });

    window.addEventListener('mouseup', () => { dragging = false; });

    // Touch support (single-finger pan + two-finger pinch-to-zoom)
    let lastTouch  = null;   // single-finger pan anchor
    let lastPinch  = null;   // two-finger pinch state

    function pinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function pinchMid(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2,
        };
    }

    svgEl.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
            lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY,
                          tx: transform.tx, ty: transform.ty };
            lastPinch = null;
        } else if (e.touches.length === 2) {
            lastTouch = null;
            lastPinch = { dist: pinchDist(e.touches), mid: pinchMid(e.touches),
                          tx: transform.tx, ty: transform.ty, scale: transform.scale };
        }
        e.preventDefault();
    }, { passive: false });

    svgEl.addEventListener('touchmove', e => {
        if (e.touches.length === 1 && lastTouch) {
            // single-finger pan
            transform.tx = lastTouch.tx + (e.touches[0].clientX - lastTouch.x);
            transform.ty = lastTouch.ty + (e.touches[0].clientY - lastTouch.y);
            applyTransform();
        } else if (e.touches.length === 2 && lastPinch) {
            // two-finger pinch-to-zoom toward midpoint
            const dist   = pinchDist(e.touches);
            const mid    = pinchMid(e.touches);
            const factor = dist / lastPinch.dist;
            const newScale = Math.max(0.15, Math.min(4, lastPinch.scale * factor));
            // zoom toward the pinch midpoint
            transform.tx    = mid.x - factor * (lastPinch.mid.x - lastPinch.tx);
            transform.ty    = mid.y - factor * (lastPinch.mid.y - lastPinch.ty);
            transform.scale = newScale;
            applyTransform();
        }
        e.preventDefault();
    }, { passive: false });

    svgEl.addEventListener('touchend', e => {
        if (e.touches.length === 0) { lastTouch = null; lastPinch = null; }
        else if (e.touches.length === 1) { lastPinch = null; }
    }, { passive: false });

    // Wheel: pinch-to-zoom (ctrlKey = trackpad pinch) or pan
    svgEl.addEventListener('wheel', e => {
        e.preventDefault();
        if (e.ctrlKey) {
            // Trackpad pinch — zoom toward cursor
            const rect   = svgEl.getBoundingClientRect();
            const mx     = e.clientX - rect.left;
            const my     = e.clientY - rect.top;
            const factor = Math.pow(0.995, e.deltaY);   // smooth exponential
            transform.tx    = mx - factor * (mx - transform.tx);
            transform.ty    = my - factor * (my - transform.ty);
            transform.scale = Math.max(0.15, Math.min(4, transform.scale * factor));
        } else {
            // Regular scroll — pan
            const speed = 1.2;
            if (e.shiftKey) {
                transform.tx -= e.deltaY * speed;
            } else {
                transform.tx -= e.deltaX * speed;
                transform.ty -= e.deltaY * speed;
            }
        }
        applyTransform();
    }, { passive: false });
}

// ── Zoom button controls ──────────────────────────────────────────────────────
function initZoomButtons() {
    $('btn-zoom-in').addEventListener('click', () => {
        zoomAround(0.5, 0.5, 1.25);
    });
    $('btn-zoom-out').addEventListener('click', () => {
        zoomAround(0.5, 0.5, 0.8);
    });
    $('btn-zoom-fit').addEventListener('click', fitToScreen);
}

function zoomAround(cx, cy, factor) {
    const rect = svgEl.getBoundingClientRect();
    const mx   = rect.width  * cx;
    const my   = rect.height * cy;
    transform.tx    = mx - factor * (mx - transform.tx);
    transform.ty    = my - factor * (my - transform.ty);
    transform.scale = Math.max(0.15, Math.min(4, transform.scale * factor));
    applyTransform();
}

function fitToScreen() {
    const rect    = svgEl.getBoundingClientRect();
    const scaleX  = rect.width  / DATAPATH_BOUNDS.w;
    const scaleY  = rect.height / DATAPATH_BOUNDS.h;
    const scale   = Math.min(scaleX, scaleY) * 0.92;
    const tx      = (rect.width  - DATAPATH_BOUNDS.w * scale) / 2 - DATAPATH_BOUNDS.x * scale;
    const ty      = (rect.height - DATAPATH_BOUNDS.h * scale) / 2 - DATAPATH_BOUNDS.y * scale;
    transform     = { tx, ty, scale };
    applyTransform();
}

// ── Wire all controls up ──────────────────────────────────────────────────────
function initControls() {
    $('btn-assemble').addEventListener('click',    doAssemble);
    $('btn-step').addEventListener('click',        doStep);
    $('btn-step-back').addEventListener('click',   doStepBack);
    $('btn-reset').addEventListener('click',       doReset);
    $('btn-play').addEventListener('click',        doPlay);
    $('btn-pause').addEventListener('click',       pausePlay);
    $('btn-format').addEventListener('click',      toggleFormat);
    $('btn-theme').addEventListener('click',       toggleTheme);
    $('modal-close').addEventListener('click',     closeModal);
    $('modal-overlay').addEventListener('click', e => {
        if (e.target === $('modal-overlay')) closeModal();
    });

    $('examples-select').addEventListener('change', e => {
        const key = e.target.value;
        if (key) {
            loadExample(key);
            e.target.value = '';   // reset dropdown so same option can be re-selected
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.target.closest('.CodeMirror') || e.target.tagName === 'TEXTAREA') return;
        if (e.target.tagName === 'SELECT') return;
        switch (e.key) {
            case 'ArrowRight': case 'n': doStep();     break;
            case 'ArrowLeft':  case 'p': doStepBack(); break;
            case 'r':                    doReset();     break;
            case ' ':
                e.preventDefault();
                playTimer ? pausePlay() : doPlay();
                break;
        }
    });
}
