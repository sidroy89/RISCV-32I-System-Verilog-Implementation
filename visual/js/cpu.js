// cpu.js — RV32I single-cycle CPU simulator
// Mirrors rtl/ modules exactly: field_extractor, imm_gen, decoder,
// regfile, alu, branch_logic, dmem, datapath.

'use strict';

const BASE_ADDR  = 0x80000000;
const IMEM_WORDS = 16384;   // 64 KB instruction memory (word-addressed)
const DMEM_BYTES = 16384;   // 16 KB data memory — matches #(.MEM_SIZE(16384)) in RTL
const MAX_HISTORY = 1000;   // cap step-back history to avoid excessive memory use

// ALU op codes — must match rtl/alu.sv
const ALU_ADD    = 0;
const ALU_SUB    = 1;
const ALU_AND    = 2;
const ALU_OR     = 3;
const ALU_XOR    = 4;
const ALU_SLL    = 5;
const ALU_SRL    = 6;
const ALU_SRA    = 7;
const ALU_SLT    = 8;
const ALU_SLTU   = 9;
const ALU_PASS_B = 10;  // passes B straight through — used for LUI

export class CPU {
    constructor() {
        this.imem    = new Uint32Array(IMEM_WORDS);
        this.dmem    = new Uint8Array(DMEM_BYTES);
        this.regs    = new Uint32Array(32);   // x0 always reads 0
        this.pc      = BASE_ADDR >>> 0;
        this.halted  = false;
        this.history = [];
    }

    reset() {
        this.regs.fill(0);
        this.pc      = BASE_ADDR >>> 0;
        this.halted  = false;
        this.history = [];
    }

    // Load assembled instruction words into imem.
    // words: array of 32-bit unsigned numbers.
    loadProgram(words) {
        this.imem.fill(0);
        for (let i = 0; i < words.length && i < IMEM_WORDS; i++) {
            this.imem[i] = words[i] >>> 0;
        }
    }

    // Load data bytes into dmem at a given byte offset from BASE_ADDR.
    // Used for .data section initialisation.
    loadData(bytes, addrOffset) {
        for (let i = 0; i < bytes.length && (addrOffset + i) < DMEM_BYTES; i++) {
            this.dmem[addrOffset + i] = bytes[i] & 0xFF;
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    // Sign-extend a value that occupies 'bits' significant bits.
    _sext(value, bits) {
        const shift = 32 - bits;
        return (value << shift) >> shift;   // JS >> is arithmetic (sign-extending)
    }

    // ── RTL module mirrors ───────────────────────────────────────────────────

    // Mirrors rtl/field_extractor.sv
    _fieldExtract(instr) {
        return {
            opcode: (instr)        & 0x7F,
            rd:     (instr >>>  7) & 0x1F,
            funct3: (instr >>> 12) & 0x07,
            rs1:    (instr >>> 15) & 0x1F,
            rs2:    (instr >>> 20) & 0x1F,
            funct7: (instr >>> 25) & 0x7F,
        };
    }

    // Mirrors rtl/imm_gen.sv
    _immGen(instr, opcode) {
        switch (opcode) {
            case 0x03:  // I-type: loads
            case 0x13:  // I-type: OP-IMM
            case 0x67:  // I-type: JALR
                // bits [31:20], sign-extended — JS arithmetic right shift handles this
                return instr >> 20;

            case 0x23: { // S-type: stores  — bits [31:25] | [11:7]
                const hi = (instr >> 25) & 0x7F;
                const lo = (instr >>>  7) & 0x1F;
                return this._sext((hi << 5) | lo, 12);
            }

            case 0x63: { // B-type: branches — bits [31|7|30:25|11:8], LSB=0
                const b12   = (instr >>> 31) & 1;
                const b11   = (instr >>>  7) & 1;
                const b10_5 = (instr >>> 25) & 0x3F;
                const b4_1  = (instr >>>  8) & 0x0F;
                return this._sext((b12 << 12) | (b11 << 11) | (b10_5 << 5) | (b4_1 << 1), 13);
            }

            case 0x37:  // U-type: LUI
            case 0x17:  // U-type: AUIPC
                return (instr & 0xFFFFF000) | 0;   // bits [31:12], lower 12 = 0

            case 0x6F: { // J-type: JAL — bits [31|19:12|20|30:21], LSB=0
                const b20    = (instr >>> 31) & 1;
                const b19_12 = (instr >>> 12) & 0xFF;
                const b11    = (instr >>> 20) & 1;
                const b10_1  = (instr >>> 21) & 0x3FF;
                return this._sext((b20 << 20) | (b19_12 << 12) | (b11 << 11) | (b10_1 << 1), 21);
            }

            default: return 0;
        }
    }

    // Mirrors rtl/decoder.sv — returns all 10 control signals
    _decode(opcode, funct3, funct7) {
        // defaults match the RTL always_comb defaults
        const c = {
            writeback_mux: 0b00,
            reg_write_en:  0,
            PC_or_Rs1_mux: 0,
            alu_src_mux_1: 0,
            alu_src_mux_2: 0,
            alu_op:        ALU_ADD,
            branch:        0,
            jump:          0,
            dmem_wr_en:    0,
            dmem_rd_en:    0,
        };

        switch (opcode) {

            case 0x33: { // R-type
                c.reg_write_en  = 1;
                c.writeback_mux = 0b01;
                // mirrors: case ({funct3, funct7}) in RTL
                const f3f7 = (funct3 << 7) | funct7;
                switch (f3f7) {
                    case (0b000 << 7) | 0b0000000: c.alu_op = ALU_ADD;  break; // ADD
                    case (0b000 << 7) | 0b0100000: c.alu_op = ALU_SUB;  break; // SUB
                    case (0b111 << 7) | 0b0000000: c.alu_op = ALU_AND;  break; // AND
                    case (0b110 << 7) | 0b0000000: c.alu_op = ALU_OR;   break; // OR
                    case (0b100 << 7) | 0b0000000: c.alu_op = ALU_XOR;  break; // XOR
                    case (0b001 << 7) | 0b0000000: c.alu_op = ALU_SLL;  break; // SLL
                    case (0b101 << 7) | 0b0000000: c.alu_op = ALU_SRL;  break; // SRL
                    case (0b101 << 7) | 0b0100000: c.alu_op = ALU_SRA;  break; // SRA
                    case (0b010 << 7) | 0b0000000: c.alu_op = ALU_SLT;  break; // SLT
                    case (0b011 << 7) | 0b0000000: c.alu_op = ALU_SLTU; break; // SLTU
                    default: c.alu_op = ALU_ADD;
                }
                break;
            }

            case 0x13: { // I-type OP-IMM
                c.reg_write_en  = 1;
                c.alu_src_mux_2 = 1;
                c.writeback_mux = 0b01;
                switch (funct3) {
                    case 0b000: c.alu_op = ALU_ADD;  break; // ADDI
                    case 0b111: c.alu_op = ALU_AND;  break; // ANDI
                    case 0b110: c.alu_op = ALU_OR;   break; // ORI
                    case 0b100: c.alu_op = ALU_XOR;  break; // XORI
                    case 0b010: c.alu_op = ALU_SLT;  break; // SLTI
                    case 0b011: c.alu_op = ALU_SLTU; break; // SLTIU
                    case 0b001: c.alu_op = ALU_SLL;  break; // SLLI
                    case 0b101:
                        c.alu_op = (funct7 === 0b0100000) ? ALU_SRA : ALU_SRL; // SRAI / SRLI
                        break;
                    default: c.alu_op = ALU_ADD;
                }
                break;
            }

            case 0x03: // Loads
                c.reg_write_en  = 1;
                c.alu_src_mux_2 = 1;
                c.dmem_rd_en    = 1;
                c.writeback_mux = 0b10;
                c.alu_op        = ALU_ADD;
                break;

            case 0x23: // Stores
                c.alu_src_mux_2 = 1;
                c.dmem_wr_en    = 1;
                c.alu_op        = ALU_ADD;
                break;

            case 0x63: // Branches
                c.branch = 1;
                switch (funct3) {
                    case 0b000: c.alu_op = ALU_SUB;  break; // BEQ  — zero flag
                    case 0b001: c.alu_op = ALU_SUB;  break; // BNE  — non-zero
                    case 0b100: c.alu_op = ALU_SLT;  break; // BLT  — result=1
                    case 0b101: c.alu_op = ALU_SLT;  break; // BGE  — result=0
                    case 0b110: c.alu_op = ALU_SLTU; break; // BLTU — result=1
                    case 0b111: c.alu_op = ALU_SLTU; break; // BGEU — result=0
                    default:    c.alu_op = ALU_SUB;
                }
                break;

            case 0x6F: // JAL
                c.writeback_mux = 0b00;
                c.reg_write_en  = 1;
                c.PC_or_Rs1_mux = 0;   // use PC for target adder
                c.jump          = 1;
                break;

            case 0x67: // JALR
                c.writeback_mux = 0b00;
                c.reg_write_en  = 1;
                c.PC_or_Rs1_mux = 1;   // use Rs1 for target adder
                c.jump          = 1;
                break;

            case 0x37: // LUI
                c.reg_write_en  = 1;
                c.alu_src_mux_2 = 1;
                c.alu_op        = ALU_PASS_B;
                c.writeback_mux = 0b01;
                break;

            case 0x17: // AUIPC
                c.reg_write_en  = 1;
                c.alu_src_mux_1 = 1;   // ALU input A = PC
                c.alu_src_mux_2 = 1;
                c.alu_op        = ALU_ADD;
                c.writeback_mux = 0b01;
                break;

            case 0x73: // SYSTEM — ecall/ebreak, do nothing
                break;

            default:
                break;
        }

        return c;
    }

    // Mirrors rtl/alu.sv
    _alu(op, a, b) {
        const shamt = b & 0x1F;
        let result;
        switch (op) {
            case ALU_ADD:    result = (a + b)    | 0;  break;
            case ALU_SUB:    result = (a - b)    | 0;  break;
            case ALU_AND:    result =  a & b;           break;
            case ALU_OR:     result =  a | b;           break;
            case ALU_XOR:    result =  a ^ b;           break;
            case ALU_SLL:    result = (a << shamt) | 0; break;
            case ALU_SRL:    result =  a >>> shamt;      break;  // logical — JS >>>
            case ALU_SRA:    result =  a >> shamt;       break;  // arithmetic — JS >>
            case ALU_SLT:    result = ((a | 0) < (b | 0))       ? 1 : 0; break; // signed
            case ALU_SLTU:   result = ((a >>> 0) < (b >>> 0))   ? 1 : 0; break; // unsigned
            case ALU_PASS_B: result = b;                break;
            default:         result = 0;
        }
        result = result >>> 0;  // normalise to unsigned 32-bit
        return { result, zero: result === 0 };
    }

    // Mirrors rtl/branch_logic.sv
    _branchLogic(aluResult, funct3, branch, jump) {
        if (jump)    return 1;
        if (!branch) return 0;
        switch (funct3) {
            case 0b000: return (aluResult === 0) ? 1 : 0; // BEQ:  SUB==0
            case 0b001: return (aluResult !== 0) ? 1 : 0; // BNE:  SUB!=0
            case 0b100: return (aluResult === 1) ? 1 : 0; // BLT:  SLT==1
            case 0b101: return (aluResult === 0) ? 1 : 0; // BGE:  SLT==0
            case 0b110: return (aluResult === 1) ? 1 : 0; // BLTU: SLTU==1
            case 0b111: return (aluResult === 0) ? 1 : 0; // BGEU: SLTU==0
            default:    return 0;
        }
    }

    // Mirrors combinational read in rtl/dmem.sv
    _dmemRead(addr, funct3) {
        const off = (addr >>> 0) - 0x80000000;
        if (off < 0 || off + 3 >= DMEM_BYTES) return 0;
        switch (funct3) {
            case 0b000: return this._sext(this.dmem[off], 8);                                // LB
            case 0b001: return this._sext(this.dmem[off] | (this.dmem[off+1] << 8), 16);    // LH
            case 0b010: return (this.dmem[off]           |
                                (this.dmem[off+1] <<  8) |
                                (this.dmem[off+2] << 16) |
                                (this.dmem[off+3] << 24)) >>> 0;                             // LW
            case 0b100: return this.dmem[off];                                               // LBU
            case 0b101: return (this.dmem[off] | (this.dmem[off+1] << 8)) >>> 0;            // LHU
            default:    return 0;
        }
    }

    // Mirrors synchronous write in rtl/dmem.sv
    _dmemWrite(addr, data, funct3) {
        const off = (addr >>> 0) - 0x80000000;
        if (off < 0 || off + 3 >= DMEM_BYTES) return;
        switch (funct3) {
            case 0b000: // SB
                this.dmem[off]   =  data         & 0xFF;
                break;
            case 0b001: // SH
                this.dmem[off]   =  data         & 0xFF;
                this.dmem[off+1] = (data >>>  8) & 0xFF;
                break;
            case 0b010: // SW
                this.dmem[off]   =  data         & 0xFF;
                this.dmem[off+1] = (data >>>  8) & 0xFF;
                this.dmem[off+2] = (data >>> 16) & 0xFF;
                this.dmem[off+3] = (data >>> 24) & 0xFF;
                break;
            // default: unsupported funct3, do nothing (matches RTL)
        }
    }

    // ── Main clock step ──────────────────────────────────────────────────────

    // Execute one cycle. Returns a full signal snapshot for the visualizer,
    // or null if the CPU is already halted.
    // The snapshot contains every wire value visible in the datapath diagram.
    step() {
        if (this.halted) return null;

        // Save current state for step-back before modifying anything
        if (this.history.length >= MAX_HISTORY) this.history.shift();
        this.history.push({
            pc:   this.pc,
            regs: new Uint32Array(this.regs),
            dmem: new Uint8Array(this.dmem),
        });

        const pc = this.pc >>> 0;

        // ── IMEM fetch ────────────────────────────────────────────────────
        const imemIdx = (pc - 0x80000000) >>> 2;
        const instr   = (imemIdx < IMEM_WORDS) ? this.imem[imemIdx] : 0;

        // ── Field extractor ───────────────────────────────────────────────
        const { opcode, rd, funct3, rs1, rs2, funct7 } = this._fieldExtract(instr);

        // ── Immediate generator ───────────────────────────────────────────
        const imm = this._immGen(instr, opcode) >>> 0;

        // ── Decoder ───────────────────────────────────────────────────────
        const ctrl = this._decode(opcode, funct3, funct7);

        // ── Register file reads (x0 hardwired to 0) ───────────────────────
        const rs1_data = (rs1 === 0 ? 0 : this.regs[rs1]) >>> 0;
        const rs2_data = (rs2 === 0 ? 0 : this.regs[rs2]) >>> 0;

        // ── ALU input muxes ───────────────────────────────────────────────
        const alu_a = (ctrl.alu_src_mux_1 ? pc       : rs1_data) >>> 0;
        const alu_b = (ctrl.alu_src_mux_2 ? imm      : rs2_data) >>> 0;

        // ── ALU ───────────────────────────────────────────────────────────
        const { result: alu_result, zero: alu_zero } = this._alu(ctrl.alu_op, alu_a, alu_b);

        // ── PC adders ─────────────────────────────────────────────────────
        const pc_plus4  = (pc + 4) >>> 0;
        const pc_base   = ctrl.PC_or_Rs1_mux ? rs1_data : pc;
        const pc_target = ((pc_base >>> 0) + (imm | 0)) >>> 0;  // imm|0 = signed for correct negative offset

        // ── Branch logic ──────────────────────────────────────────────────
        const pc_src  = this._branchLogic(alu_result, funct3, ctrl.branch, ctrl.jump);
        const pc_next = (pc_src ? pc_target : pc_plus4) >>> 0;

        // ── Data memory read (combinational) ──────────────────────────────
        const dmem_rdata = ctrl.dmem_rd_en
            ? (this._dmemRead(alu_result, funct3) >>> 0)
            : 0;

        // ── Writeback mux ─────────────────────────────────────────────────
        let wb_data;
        switch (ctrl.writeback_mux) {
            case 0b00: wb_data = pc_plus4;   break;
            case 0b01: wb_data = alu_result; break;
            case 0b10: wb_data = dmem_rdata; break;
            default:   wb_data = alu_result;
        }
        wb_data = wb_data >>> 0;

        // ── ecall detection ───────────────────────────────────────────────
        const is_ecall = (opcode === 0x73);

        // ── Sequential updates (clock edge) ───────────────────────────────
        if (ctrl.dmem_wr_en) {
            this._dmemWrite(alu_result, rs2_data, funct3);
        }
        if (ctrl.reg_write_en && rd !== 0) {
            this.regs[rd] = wb_data;
        }
        this.pc = pc_next;
        if (is_ecall) this.halted = true;

        // ── Signal snapshot returned to visualizer ────────────────────────
        return {
            // Program counter
            pc, pc_plus4, pc_target, pc_next, pc_src,

            // Raw instruction
            instr,

            // Field extractor outputs
            opcode, rd, funct3, rs1, rs2, funct7,

            // Immediate generator output
            imm: imm >>> 0,

            // Decoder outputs (all 10 control signals)
            ctrl,

            // Register file outputs
            rs1_data, rs2_data,

            // ALU inputs (after muxes) and outputs
            alu_a, alu_b, alu_result, alu_zero,

            // Data memory output
            dmem_rdata,

            // Writeback
            wb_data,

            // Status
            is_ecall,
            halted: this.halted,

            // Full register file snapshot (for the regfile display panel)
            regs: new Uint32Array(this.regs),
        };
    }

    // Step backward one cycle by restoring the previous saved state.
    // Returns false if there is no history to go back to.
    stepBack() {
        if (this.history.length === 0) return false;
        const prev   = this.history.pop();
        this.pc      = prev.pc;
        this.regs    = new Uint32Array(prev.regs);
        this.dmem    = new Uint8Array(prev.dmem);
        this.halted  = false;
        return true;
    }

    // Returns whether there is any history to step back into
    canStepBack() {
        return this.history.length > 0;
    }
}
