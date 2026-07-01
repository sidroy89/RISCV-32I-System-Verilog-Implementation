// assembler.js — RV32I two-pass assembler
// Supports: all 40 base RV32I instructions (no fence/fence.i), labels,
// # and // comments, .data section directives.
// Returns encoded words, assembled data bytes, label map, source map, and errors.

'use strict';

export const TEXT_BASE        = 0x80000000;
export const DATA_BASE        = 0x80002000;  // data section lives at dmem offset 0x2000
export const DATA_DMEM_OFFSET = 0x2000;      // = DATA_BASE - 0x80000000

// ── Register table (xN and ABI names) ───────────────────────────────────────

const REGS = {
    x0:0,  x1:1,  x2:2,  x3:3,  x4:4,  x5:5,  x6:6,  x7:7,
    x8:8,  x9:9,  x10:10,x11:11,x12:12,x13:13,x14:14,x15:15,
    x16:16,x17:17,x18:18,x19:19,x20:20,x21:21,x22:22,x23:23,
    x24:24,x25:25,x26:26,x27:27,x28:28,x29:29,x30:30,x31:31,
    zero:0, ra:1,  sp:2,  gp:3,  tp:4,
    t0:5,   t1:6,  t2:7,
    s0:8,   fp:8,  s1:9,
    a0:10,  a1:11, a2:12, a3:13, a4:14, a5:15, a6:16, a7:17,
    s2:18,  s3:19, s4:20, s5:21, s6:22, s7:23, s8:24, s9:25, s10:26, s11:27,
    t3:28,  t4:29, t5:30, t6:31,
};

// ── Instruction table ────────────────────────────────────────────────────────
// fmt:
//   R   — rd, rs1, rs2
//   I   — rd, rs1, imm12
//   IS  — rd, rs1, shamt(0-31)   (shifts: SLLI/SRLI/SRAI)
//   IL  — rd, imm12(rs1)         (loads)
//   S   — rs2, imm12(rs1)        (stores)
//   B   — rs1, rs2, label|imm
//   U   — rd, imm20
//   J   — rd, label|imm
//   JR  — rd, rs1, imm12  OR  rd, imm12(rs1)   (JALR)
//   SYS — no operands

const INSTR = {
    // R-type
    ADD:  { fmt:'R',  op:0x33, f3:0b000, f7:0b0000000 },
    SUB:  { fmt:'R',  op:0x33, f3:0b000, f7:0b0100000 },
    SLL:  { fmt:'R',  op:0x33, f3:0b001, f7:0b0000000 },
    SLT:  { fmt:'R',  op:0x33, f3:0b010, f7:0b0000000 },
    SLTU: { fmt:'R',  op:0x33, f3:0b011, f7:0b0000000 },
    XOR:  { fmt:'R',  op:0x33, f3:0b100, f7:0b0000000 },
    SRL:  { fmt:'R',  op:0x33, f3:0b101, f7:0b0000000 },
    SRA:  { fmt:'R',  op:0x33, f3:0b101, f7:0b0100000 },
    OR:   { fmt:'R',  op:0x33, f3:0b110, f7:0b0000000 },
    AND:  { fmt:'R',  op:0x33, f3:0b111, f7:0b0000000 },
    // I-type OP-IMM
    ADDI:  { fmt:'I',  op:0x13, f3:0b000 },
    SLTI:  { fmt:'I',  op:0x13, f3:0b010 },
    SLTIU: { fmt:'I',  op:0x13, f3:0b011 },
    XORI:  { fmt:'I',  op:0x13, f3:0b100 },
    ORI:   { fmt:'I',  op:0x13, f3:0b110 },
    ANDI:  { fmt:'I',  op:0x13, f3:0b111 },
    SLLI:  { fmt:'IS', op:0x13, f3:0b001, f7:0b0000000 },
    SRLI:  { fmt:'IS', op:0x13, f3:0b101, f7:0b0000000 },
    SRAI:  { fmt:'IS', op:0x13, f3:0b101, f7:0b0100000 },
    // Loads
    LB:   { fmt:'IL', op:0x03, f3:0b000 },
    LH:   { fmt:'IL', op:0x03, f3:0b001 },
    LW:   { fmt:'IL', op:0x03, f3:0b010 },
    LBU:  { fmt:'IL', op:0x03, f3:0b100 },
    LHU:  { fmt:'IL', op:0x03, f3:0b101 },
    // Stores
    SB:   { fmt:'S',  op:0x23, f3:0b000 },
    SH:   { fmt:'S',  op:0x23, f3:0b001 },
    SW:   { fmt:'S',  op:0x23, f3:0b010 },
    // Branches
    BEQ:  { fmt:'B',  op:0x63, f3:0b000 },
    BNE:  { fmt:'B',  op:0x63, f3:0b001 },
    BLT:  { fmt:'B',  op:0x63, f3:0b100 },
    BGE:  { fmt:'B',  op:0x63, f3:0b101 },
    BLTU: { fmt:'B',  op:0x63, f3:0b110 },
    BGEU: { fmt:'B',  op:0x63, f3:0b111 },
    // U-type
    LUI:   { fmt:'U', op:0x37 },
    AUIPC: { fmt:'U', op:0x17 },
    // J-type
    JAL:  { fmt:'J',  op:0x6F },
    JALR: { fmt:'JR', op:0x67, f3:0b000 },
    // System
    ECALL:  { fmt:'SYS', enc:0x00000073 },
    EBREAK: { fmt:'SYS', enc:0x00100073 },
};

// ── Bit-field encoders ───────────────────────────────────────────────────────

function encodeR(f7, rs2, rs1, f3, rd, op) {
    return (((f7  & 0x7F) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) |
            ((f3  & 0x07) << 12) | ((rd  & 0x1F) <<  7) |  (op  & 0x7F)) >>> 0;
}

function encodeI(imm, rs1, f3, rd, op) {
    return ((((imm & 0xFFF) << 20) | ((rs1 & 0x1F) << 15) |
             ((f3  & 0x007) << 12) | ((rd  & 0x1F) <<  7) | (op & 0x7F)) >>> 0);
}

// IS: shift immediate — upper 7 bits = funct7, lower 5 bits = shamt
function encodeIS(f7, shamt, rs1, f3, rd, op) {
    return encodeI((f7 << 5) | (shamt & 0x1F), rs1, f3, rd, op);
}

function encodeS(imm, rs2, rs1, f3, op) {
    const hi = (imm >>  5) & 0x7F;
    const lo =  imm        & 0x1F;
    return (((hi  & 0x7F) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) |
            ((f3  & 0x07) << 12) | ((lo  & 0x1F) <<  7) |  (op  & 0x7F)) >>> 0;
}

function encodeB(imm, rs2, rs1, f3, op) {
    const b12   = (imm >>> 12) & 1;
    const b10_5 = (imm >>>  5) & 0x3F;
    const b4_1  = (imm >>>  1) & 0x0F;
    const b11   = (imm >>> 11) & 1;
    return (( b12   << 31) | (b10_5 << 25) | ((rs2 & 0x1F) << 20) |
            ((rs1 & 0x1F) << 15) | ((f3 & 0x7) << 12) |
            ( b4_1 <<  8) | (b11 << 7) | (op & 0x7F)) >>> 0;
}

function encodeU(imm, rd, op) {
    return (((imm & 0xFFFFF) << 12) | ((rd & 0x1F) << 7) | (op & 0x7F)) >>> 0;
}

function encodeJ(imm, rd, op) {
    const b20    = (imm >>> 20) & 1;
    const b10_1  = (imm >>>  1) & 0x3FF;
    const b11    = (imm >>> 11) & 1;
    const b19_12 = (imm >>> 12) & 0xFF;
    return ((b20 << 31) | (b10_1 << 21) | (b11 << 20) |
            (b19_12 << 12) | ((rd & 0x1F) << 7) | (op & 0x7F)) >>> 0;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

// Strip // and # comments, then trim whitespace.
function stripComment(line) {
    // handle // first so we don't accidentally strip # inside a string
    let i = line.indexOf('//');
    if (i !== -1) line = line.slice(0, i);
    i = line.indexOf('#');
    if (i !== -1) line = line.slice(0, i);
    return line.trim();
}

// Parse an integer literal: decimal, 0x hex, 0b binary. Returns number or null.
function parseInt_(s) {
    s = s.trim();
    if (s === '' || s === null) return null;
    if (/^-?0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^-?0b[01]+$/.test(s))        return parseInt(s.replace('0b','').replace('-0b','-'), 2) * (s.startsWith('-') ? -1 : 1);
    if (/^-?[0-9]+$/.test(s))         return parseInt(s, 10);
    return null;
}

// Parse a register name. Returns register number or null.
function parseReg(s) {
    s = s.trim().toLowerCase();
    return (s in REGS) ? REGS[s] : null;
}

// Parse "imm(rs1)" into {imm, rs1} or null.
function parseMemOp(s) {
    const m = s.trim().match(/^(-?(?:0x[0-9a-fA-F]+|0b[01]+|[0-9]+))\((\w+)\)$/i);
    if (!m) return null;
    const imm = parseInt_(m[1]);
    const rs1 = parseReg(m[2]);
    if (imm === null || rs1 === null) return null;
    return { imm, rs1 };
}

// Split operand string by commas, respecting parentheses (so "4(x1)" stays whole).
function splitOperands(s) {
    return s.split(',').map(x => x.trim()).filter(x => x !== '');
}

// Validate a signed immediate fits in `bits` bits.
function checkImm(val, bits, lineNum, errors) {
    const lo = -(1 << (bits - 1));
    const hi =  (1 << (bits - 1)) - 1;
    if (val < lo || val > hi) {
        errors.push({ line: lineNum, message: `Immediate ${val} out of range [${lo}, ${hi}] for ${bits}-bit field` });
        return false;
    }
    return true;
}

// Validate an unsigned immediate fits in `bits` bits.
function checkUImm(val, bits, lineNum, errors) {
    if (val < 0 || val >= (1 << bits)) {
        errors.push({ line: lineNum, message: `Immediate ${val} out of range [0, ${(1<<bits)-1}] for ${bits}-bit unsigned field` });
        return false;
    }
    return true;
}

// Resolve an operand that can be a label name or a numeric literal.
// Returns the numeric value, or null and pushes an error if not found.
function resolveImm(tok, labels, lineNum, errors) {
    const n = parseInt_(tok);
    if (n !== null) return n;
    if (labels.has(tok)) return labels.get(tok);
    errors.push({ line: lineNum, message: `Undefined label or invalid immediate: '${tok}'` });
    return null;
}

// Parse a .string/.ascii value between quotes, handling escape sequences.
function parseStringLiteral(s, lineNum, errors) {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!m) {
        errors.push({ line: lineNum, message: `Invalid string literal: ${s}` });
        return null;
    }
    const bytes = [];
    const raw = m[1];
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '\\') {
            i++;
            switch (raw[i]) {
                case 'n':  bytes.push(0x0A); break;
                case 't':  bytes.push(0x09); break;
                case 'r':  bytes.push(0x0D); break;
                case '0':  bytes.push(0x00); break;
                case '\\': bytes.push(0x5C); break;
                case '"':  bytes.push(0x22); break;
                default:
                    errors.push({ line: lineNum, message: `Unknown escape sequence: \\${raw[i]}` });
                    return null;
            }
        } else {
            bytes.push(raw.charCodeAt(i));
        }
    }
    return bytes;
}

// ── Main assembler ───────────────────────────────────────────────────────────

export function assemble(source) {
    const errors    = [];
    const labels    = new Map();   // label name → byte address
    const sourceMap = new Map();   // instruction byte address → source line number (0-indexed)

    const rawLines  = source.split('\n');
    const lines     = rawLines.map(stripComment);

    // Items collected during pass 1:
    // { type:'instr', lineNum, addr, mnemonic, operandStr }
    // { type:'data',  lineNum, addr, directive, operandStr }
    const items = [];

    let section  = 'text';
    let textAddr = TEXT_BASE;
    let dataAddr = DATA_BASE;

    // ── Pass 1: collect labels and assign addresses ───────────────────────────

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line === '') continue;

        // Extract label(s) — a line can have "label: instruction"
        while (true) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) break;
            const candidate = line.slice(0, colonIdx).trim();
            // A label token must be a single word (no spaces, not a mnemonic operand)
            if (!/^\w+$/.test(candidate)) break;
            const labelName = candidate;
            if (labels.has(labelName)) {
                errors.push({ line: i, message: `Duplicate label: '${labelName}'` });
            }
            labels.set(labelName, section === 'text' ? textAddr : dataAddr);
            line = line.slice(colonIdx + 1).trim();
        }

        if (line === '') continue;

        // Section directives
        if (line.startsWith('.')) {
            const parts   = line.match(/^(\.\w+)\s*(.*)?$/);
            if (!parts) continue;
            const dir     = parts[1].toLowerCase();
            const operands = (parts[2] || '').trim();

            switch (dir) {
                case '.text':
                    section = 'text';
                    break;
                case '.data':
                    section = 'data';
                    break;
                case '.word':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'word', operandStr:operands });
                    dataAddr += 4 * Math.max(1, operands.split(',').length);
                    break;
                case '.half':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'half', operandStr:operands });
                    dataAddr += 2 * Math.max(1, operands.split(',').length);
                    break;
                case '.byte':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'byte', operandStr:operands });
                    dataAddr += Math.max(1, operands.split(',').length);
                    break;
                case '.space':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'space', operandStr:operands });
                    dataAddr += parseInt_(operands.split(',')[0]) || 0;
                    break;
                case '.string':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'string', operandStr:operands });
                    // Rough size estimate: count chars + 1 for null. Pass 2 computes exact size.
                    dataAddr += (operands.length + 2);
                    break;
                case '.ascii':
                    items.push({ type:'data', lineNum:i, addr:dataAddr, directive:'ascii', operandStr:operands });
                    dataAddr += (operands.length + 1);
                    break;
                case '.align': {
                    const n = parseInt_(operands) ?? 0;
                    const align = 1 << n;
                    if (section === 'text') textAddr = (textAddr + align - 1) & ~(align - 1);
                    else                    dataAddr = (dataAddr + align - 1) & ~(align - 1);
                    break;
                }
                default:
                    // silently ignore unrecognised directives (e.g. .globl, .type)
                    break;
            }
            continue;
        }

        // Instruction line
        const spaceIdx  = line.search(/\s/);
        const mnemonic  = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toUpperCase();
        const operandStr = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim();

        if (!(mnemonic in INSTR)) {
            errors.push({ line: i, message: `Unknown instruction: '${mnemonic}'` });
            textAddr += 4;   // still advance so subsequent label addresses stay sane
            continue;
        }

        items.push({ type:'instr', lineNum:i, addr:textAddr, mnemonic, operandStr });
        sourceMap.set(textAddr, i);
        textAddr += 4;
    }

    // ── Pass 2: encode instructions and data ──────────────────────────────────

    const wordCount = (textAddr - TEXT_BASE) / 4;
    const words     = new Uint32Array(wordCount);

    // dataBytes is a flat array; we track offset into it separately
    const dataByteArr = [];

    for (const item of items) {

        // ── Data directives ─────────────────────────────────────────────────
        if (item.type === 'data') {
            const off = item.addr - DATA_BASE;   // offset into dataByteArr
            switch (item.directive) {
                case 'word': {
                    for (const tok of splitOperands(item.operandStr)) {
                        const v = parseInt_(tok) ?? 0;
                        const base = off + dataByteArr.length - (item.addr - DATA_BASE);
                        // push little-endian 4 bytes
                        // (simpler: just push into a running array at the right position)
                        dataByteArr.push(v & 0xFF, (v>>>8) & 0xFF, (v>>>16) & 0xFF, (v>>>24) & 0xFF);
                    }
                    break;
                }
                case 'half': {
                    for (const tok of splitOperands(item.operandStr)) {
                        const v = parseInt_(tok) ?? 0;
                        dataByteArr.push(v & 0xFF, (v>>>8) & 0xFF);
                    }
                    break;
                }
                case 'byte': {
                    for (const tok of splitOperands(item.operandStr)) {
                        dataByteArr.push((parseInt_(tok) ?? 0) & 0xFF);
                    }
                    break;
                }
                case 'space': {
                    const n = parseInt_(item.operandStr.split(',')[0]) ?? 0;
                    for (let k = 0; k < n; k++) dataByteArr.push(0);
                    break;
                }
                case 'string': {
                    const bytes = parseStringLiteral(item.operandStr, item.lineNum, errors);
                    if (bytes) { dataByteArr.push(...bytes, 0); }   // null-terminated
                    break;
                }
                case 'ascii': {
                    const bytes = parseStringLiteral(item.operandStr, item.lineNum, errors);
                    if (bytes) { dataByteArr.push(...bytes); }      // no null terminator
                    break;
                }
            }
            continue;
        }

        // ── Instruction encoding ────────────────────────────────────────────
        const { lineNum, addr, mnemonic, operandStr } = item;
        const def  = INSTR[mnemonic];
        const ops  = splitOperands(operandStr);
        const wi   = (addr - TEXT_BASE) / 4;   // index into words[]

        let word = 0;
        let ok   = true;

        // Helper: get a register from ops[idx], push error if invalid
        const reg = (idx, name) => {
            const r = parseReg(ops[idx]);
            if (r === null) {
                errors.push({ line: lineNum, message: `Expected register for ${name}, got '${ops[idx] ?? ''}'` });
                ok = false;
            }
            return r ?? 0;
        };

        // Helper: get a numeric immediate from ops[idx]
        const imm = (idx, bits, signed=true) => {
            const v = parseInt_(ops[idx]);
            if (v === null) {
                errors.push({ line: lineNum, message: `Expected numeric immediate, got '${ops[idx] ?? ''}'` });
                ok = false;
                return 0;
            }
            if (signed) checkImm(v, bits, lineNum, errors);
            else        checkUImm(v, bits, lineNum, errors);
            return v;
        };

        // Helper: get a label or numeric immediate from ops[idx] (for branches/jumps)
        const labelOrImm = (idx, bits) => {
            if (ops[idx] === undefined) {
                errors.push({ line: lineNum, message: `Missing label or immediate operand` });
                ok = false;
                return 0;
            }
            const n = parseInt_(ops[idx]);
            if (n !== null) {
                checkImm(n, bits, lineNum, errors);
                return n;
            }
            // It's a label — resolve to byte offset from this instruction
            if (!labels.has(ops[idx])) {
                errors.push({ line: lineNum, message: `Undefined label: '${ops[idx]}'` });
                ok = false;
                return 0;
            }
            const target = labels.get(ops[idx]);
            const offset = target - addr;
            checkImm(offset, bits, lineNum, errors);
            return offset;
        };

        const expectOps = (n) => {
            if (ops.length !== n) {
                errors.push({ line: lineNum, message: `'${mnemonic}' expects ${n} operand(s), got ${ops.length}` });
                ok = false;
                return false;
            }
            return true;
        };

        switch (def.fmt) {

            case 'R': {
                if (!expectOps(3)) break;
                const rd  = reg(0, 'rd');
                const rs1 = reg(1, 'rs1');
                const rs2 = reg(2, 'rs2');
                if (ok) word = encodeR(def.f7, rs2, rs1, def.f3, rd, def.op);
                break;
            }

            case 'I': {
                if (!expectOps(3)) break;
                const rd  = reg(0, 'rd');
                const rs1 = reg(1, 'rs1');
                const v   = imm(2, 12, true);
                if (ok) word = encodeI(v & 0xFFF, rs1, def.f3, rd, def.op);
                break;
            }

            case 'IS': { // shift immediate: rd, rs1, shamt
                if (!expectOps(3)) break;
                const rd    = reg(0, 'rd');
                const rs1   = reg(1, 'rs1');
                const shamt = imm(2, 5, false);
                if (ok) word = encodeIS(def.f7, shamt, rs1, def.f3, rd, def.op);
                break;
            }

            case 'IL': { // load: rd, imm(rs1)
                if (ops.length === 1) {
                    // rd, imm(rs1) passed as a single token without comma after rd
                    errors.push({ line: lineNum, message: `'${mnemonic}' syntax: rd, imm(rs1)` });
                    ok = false;
                    break;
                }
                if (!expectOps(2)) break;
                const rd  = reg(0, 'rd');
                const mem = parseMemOp(ops[1]);
                if (!mem) {
                    errors.push({ line: lineNum, message: `Expected imm(rs1) for load address, got '${ops[1]}'` });
                    ok = false;
                    break;
                }
                checkImm(mem.imm, 12, lineNum, errors);
                if (ok) word = encodeI(mem.imm & 0xFFF, mem.rs1, def.f3, rd, def.op);
                break;
            }

            case 'S': { // store: rs2, imm(rs1)
                if (!expectOps(2)) break;
                const rs2 = reg(0, 'rs2');
                const mem = parseMemOp(ops[1]);
                if (!mem) {
                    errors.push({ line: lineNum, message: `Expected imm(rs1) for store address, got '${ops[1]}'` });
                    ok = false;
                    break;
                }
                checkImm(mem.imm, 12, lineNum, errors);
                if (ok) word = encodeS(mem.imm & 0xFFF, rs2, mem.rs1, def.f3, def.op);
                break;
            }

            case 'B': { // branch: rs1, rs2, label|imm
                if (!expectOps(3)) break;
                const rs1    = reg(0, 'rs1');
                const rs2    = reg(1, 'rs2');
                const offset = labelOrImm(2, 13);
                if (offset & 1) {
                    errors.push({ line: lineNum, message: `Branch target must be 2-byte aligned (offset ${offset} is odd)` });
                }
                if (ok) word = encodeB(offset & 0x1FFF, rs2, rs1, def.f3, def.op);
                break;
            }

            case 'U': { // LUI / AUIPC: rd, imm20
                if (!expectOps(2)) break;
                const rd = reg(0, 'rd');
                const v  = imm(1, 20, false);   // 20-bit unsigned
                if (ok) word = encodeU(v & 0xFFFFF, rd, def.op);
                break;
            }

            case 'J': { // JAL: rd, label|imm
                if (!expectOps(2)) break;
                const rd     = reg(0, 'rd');
                const offset = labelOrImm(1, 21);
                if (offset & 1) {
                    errors.push({ line: lineNum, message: `Jump target must be 2-byte aligned (offset ${offset} is odd)` });
                }
                if (ok) word = encodeJ(offset & 0x1FFFFF, rd, def.op);
                break;
            }

            case 'JR': { // JALR: rd, rs1, imm  OR  rd, imm(rs1)
                let rd, rs1, immv;
                if (ops.length === 2 && parseMemOp(ops[1])) {
                    // form: JALR rd, imm(rs1)
                    rd = reg(0, 'rd');
                    const mem = parseMemOp(ops[1]);
                    rs1  = mem.rs1;
                    immv = mem.imm;
                } else if (ops.length === 3) {
                    // form: JALR rd, rs1, imm
                    rd   = reg(0, 'rd');
                    rs1  = reg(1, 'rs1');
                    immv = imm(2, 12, true);
                } else {
                    errors.push({ line: lineNum, message: `'JALR' syntax: rd, rs1, imm  or  rd, imm(rs1)` });
                    ok = false;
                    break;
                }
                checkImm(immv, 12, lineNum, errors);
                if (ok) word = encodeI(immv & 0xFFF, rs1, def.f3, rd, def.op);
                break;
            }

            case 'SYS': { // ECALL / EBREAK — no operands
                if (ops.length !== 0 && !(ops.length === 1 && ops[0] === '')) {
                    errors.push({ line: lineNum, message: `'${mnemonic}' takes no operands` });
                }
                word = def.enc >>> 0;
                break;
            }

            default:
                errors.push({ line: lineNum, message: `Internal: unhandled format '${def.fmt}'` });
                break;
        }

        words[wi] = word >>> 0;
    }

    // Build the final data byte array at the right dmem offset
    // Fill with zeros up to DATA_DMEM_OFFSET, then our data bytes
    // (The CPU's loadData() takes bytes + offset, so we just return the bytes)
    const dataBytes = new Uint8Array(dataByteArr.length);
    dataByteArr.forEach((b, i) => { dataBytes[i] = b; });

    return {
        success:    errors.length === 0,
        words,                      // Uint32Array — load into cpu.imem via cpu.loadProgram()
        dataBytes,                  // Uint8Array  — load into cpu.dmem via cpu.loadData(bytes, DATA_DMEM_OFFSET)
        dataOffset: DATA_DMEM_OFFSET,
        labels,                     // Map<name, byteAddr>  — for display in the visualizer
        sourceMap,                  // Map<byteAddr, lineNum> — for highlighting current line
        errors,                     // [{line, message}]
    };
}
