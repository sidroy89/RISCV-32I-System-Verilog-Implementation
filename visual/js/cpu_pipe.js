// cpu_pipe.js — RV32I 5-stage pipelined CPU simulator
// Mirrors rtl/pipeline/ exactly: datapath_pipe.sv, forwarding_unit.sv, hazard_unit.sv
// Stages: IF → ID → EX → MEM → WB
// Features: full forwarding, load-use stall, branch flush (always not-taken)

'use strict';

const BASE_ADDR    = 0x80000000;
const IMEM_WORDS   = 16384;
const DMEM_BYTES   = 16384;
const MAX_HISTORY  = 500;   // less than SC (1000) — each snapshot is bigger
const NOP_INSTR    = 0x00000013;  // addi x0, x0, 0

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
const ALU_PASS_B = 10;

// ── Helper: sign-extend ──────────────────────────────────────────────────────
function sext(value, bits) {
    const shift = 32 - bits;
    return (value << shift) >> shift;
}

// ── Field extractor (mirrors rtl/pipeline/field_extractor.sv) ────────────────
function fieldExtract(instr) {
    return {
        opcode: (instr)        & 0x7F,
        rd:     (instr >>>  7) & 0x1F,
        funct3: (instr >>> 12) & 0x07,
        rs1:    (instr >>> 15) & 0x1F,
        rs2:    (instr >>> 20) & 0x1F,
        funct7: (instr >>> 25) & 0x7F,
    };
}

// ── Immediate generator (mirrors rtl/pipeline/imm_gen.sv) ────────────────────
function immGen(instr, opcode) {
    switch (opcode) {
        case 0x03: case 0x13: case 0x67:
            return instr >> 20;
        case 0x23: {
            const hi = (instr >> 25) & 0x7F;
            const lo = (instr >>> 7) & 0x1F;
            return sext((hi << 5) | lo, 12);
        }
        case 0x63: {
            const b12   = (instr >>> 31) & 1;
            const b11   = (instr >>>  7) & 1;
            const b10_5 = (instr >>> 25) & 0x3F;
            const b4_1  = (instr >>>  8) & 0x0F;
            return sext((b12 << 12) | (b11 << 11) | (b10_5 << 5) | (b4_1 << 1), 13);
        }
        case 0x37: case 0x17:
            return (instr & 0xFFFFF000) | 0;
        case 0x6F: {
            const b20    = (instr >>> 31) & 1;
            const b19_12 = (instr >>> 12) & 0xFF;
            const b11    = (instr >>> 20) & 1;
            const b10_1  = (instr >>> 21) & 0x3FF;
            return sext((b20 << 20) | (b19_12 << 12) | (b11 << 11) | (b10_1 << 1), 21);
        }
        default: return 0;
    }
}

// ── Decoder (mirrors rtl/pipeline/decoder.sv — includes JALR fix) ────────────
function decode(opcode, funct3, funct7) {
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
            const f3f7 = (funct3 << 7) | funct7;
            switch (f3f7) {
                case (0b000 << 7) | 0b0000000: c.alu_op = ALU_ADD;  break;
                case (0b000 << 7) | 0b0100000: c.alu_op = ALU_SUB;  break;
                case (0b111 << 7) | 0b0000000: c.alu_op = ALU_AND;  break;
                case (0b110 << 7) | 0b0000000: c.alu_op = ALU_OR;   break;
                case (0b100 << 7) | 0b0000000: c.alu_op = ALU_XOR;  break;
                case (0b001 << 7) | 0b0000000: c.alu_op = ALU_SLL;  break;
                case (0b101 << 7) | 0b0000000: c.alu_op = ALU_SRL;  break;
                case (0b101 << 7) | 0b0100000: c.alu_op = ALU_SRA;  break;
                case (0b010 << 7) | 0b0000000: c.alu_op = ALU_SLT;  break;
                case (0b011 << 7) | 0b0000000: c.alu_op = ALU_SLTU; break;
                default: c.alu_op = ALU_ADD;
            }
            break;
        }
        case 0x13: { // I-type OP-IMM
            c.reg_write_en  = 1;
            c.alu_src_mux_2 = 1;
            c.writeback_mux = 0b01;
            switch (funct3) {
                case 0b000: c.alu_op = ALU_ADD;  break;
                case 0b111: c.alu_op = ALU_AND;  break;
                case 0b110: c.alu_op = ALU_OR;   break;
                case 0b100: c.alu_op = ALU_XOR;  break;
                case 0b010: c.alu_op = ALU_SLT;  break;
                case 0b011: c.alu_op = ALU_SLTU; break;
                case 0b001: c.alu_op = ALU_SLL;  break;
                case 0b101: c.alu_op = (funct7 === 0b0100000) ? ALU_SRA : ALU_SRL; break;
                default:    c.alu_op = ALU_ADD;
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
                case 0b000: c.alu_op = ALU_SUB;  break;
                case 0b001: c.alu_op = ALU_SUB;  break;
                case 0b100: c.alu_op = ALU_SLT;  break;
                case 0b101: c.alu_op = ALU_SLT;  break;
                case 0b110: c.alu_op = ALU_SLTU; break;
                case 0b111: c.alu_op = ALU_SLTU; break;
                default:    c.alu_op = ALU_SUB;
            }
            break;
        case 0x6F: // JAL
            c.writeback_mux = 0b00;
            c.reg_write_en  = 1;
            c.PC_or_Rs1_mux = 0;
            c.jump          = 1;
            break;
        case 0x67: // JALR — pipeline fix: alu_src_mux_2=1, alu_op=ADD
            c.writeback_mux = 0b00;
            c.reg_write_en  = 1;
            c.PC_or_Rs1_mux = 1;
            c.jump          = 1;
            c.alu_src_mux_2 = 1;
            c.alu_op        = ALU_ADD;
            break;
        case 0x37: // LUI
            c.reg_write_en  = 1;
            c.alu_src_mux_2 = 1;
            c.alu_op        = ALU_PASS_B;
            c.writeback_mux = 0b01;
            break;
        case 0x17: // AUIPC
            c.reg_write_en  = 1;
            c.alu_src_mux_1 = 1;
            c.alu_src_mux_2 = 1;
            c.alu_op        = ALU_ADD;
            c.writeback_mux = 0b01;
            break;
        case 0x73: // SYSTEM (ecall/ebreak)
            break;
        default:
            break;
    }
    return c;
}

// ── ALU (mirrors rtl/pipeline/alu.sv) ────────────────────────────────────────
function alu(op, a, b) {
    const shamt = b & 0x1F;
    let result;
    switch (op) {
        case ALU_ADD:    result = (a + b)    | 0;    break;
        case ALU_SUB:    result = (a - b)    | 0;    break;
        case ALU_AND:    result =  a & b;             break;
        case ALU_OR:     result =  a | b;             break;
        case ALU_XOR:    result =  a ^ b;             break;
        case ALU_SLL:    result = (a << shamt) | 0;   break;
        case ALU_SRL:    result =  a >>> shamt;        break;
        case ALU_SRA:    result =  a >> shamt;         break;
        case ALU_SLT:    result = ((a | 0) < (b | 0))     ? 1 : 0; break;
        case ALU_SLTU:   result = ((a >>> 0) < (b >>> 0)) ? 1 : 0; break;
        case ALU_PASS_B: result = b;                  break;
        default:         result = 0;
    }
    return (result >>> 0);
}

// ── Branch logic (mirrors rtl/pipeline/branch_logic.sv) ──────────────────────
function branchLogic(aluResult, funct3, branch, jump) {
    if (jump)    return 1;
    if (!branch) return 0;
    switch (funct3) {
        case 0b000: return (aluResult === 0) ? 1 : 0;
        case 0b001: return (aluResult !== 0) ? 1 : 0;
        case 0b100: return (aluResult === 1) ? 1 : 0;
        case 0b101: return (aluResult === 0) ? 1 : 0;
        case 0b110: return (aluResult === 1) ? 1 : 0;
        case 0b111: return (aluResult === 0) ? 1 : 0;
        default:    return 0;
    }
}

// ── Forwarding unit (mirrors rtl/pipeline/forwarding_unit.sv) ────────────────
function forwardingUnit(idex_rs1, idex_rs2, exmem_rd, exmem_rwe, memwb_rd, memwb_rwe) {
    let forward_a = 0, forward_b = 0;

    // EX/MEM takes priority (most recent)
    if (exmem_rwe && exmem_rd !== 0 && exmem_rd === idex_rs1)
        forward_a = 0b01;
    else if (memwb_rwe && memwb_rd !== 0 && memwb_rd === idex_rs1)
        forward_a = 0b10;

    if (exmem_rwe && exmem_rd !== 0 && exmem_rd === idex_rs2)
        forward_b = 0b01;
    else if (memwb_rwe && memwb_rd !== 0 && memwb_rd === idex_rs2)
        forward_b = 0b10;

    return { forward_a, forward_b };
}

// ── Hazard unit (mirrors rtl/pipeline/hazard_unit.sv) ────────────────────────
function hazardUnit(idex_rd, idex_mem_read, id_rs1, id_rs2) {
    return idex_mem_read && (idex_rd === id_rs1 || idex_rd === id_rs2) ? 1 : 0;
}

// ── DMEM read (mirrors rtl/pipeline/dmem.sv combinational read) ──────────────
function dmemRead(mem, addr, funct3) {
    const off = (addr >>> 0) - 0x80000000;
    if (off < 0 || off + 3 >= DMEM_BYTES) return 0;
    switch (funct3) {
        case 0b000: return sext(mem[off], 8);
        case 0b001: return sext(mem[off] | (mem[off+1] << 8), 16);
        case 0b010: return (mem[off] | (mem[off+1] << 8) | (mem[off+2] << 16) | (mem[off+3] << 24)) >>> 0;
        case 0b100: return mem[off];
        case 0b101: return (mem[off] | (mem[off+1] << 8)) >>> 0;
        default:    return 0;
    }
}

// ── DMEM write (mirrors rtl/pipeline/dmem.sv synchronous write) ──────────────
function dmemWrite(mem, addr, data, funct3) {
    const off = (addr >>> 0) - 0x80000000;
    if (off < 0 || off + 3 >= DMEM_BYTES) return;
    switch (funct3) {
        case 0b000:
            mem[off] = data & 0xFF;
            break;
        case 0b001:
            mem[off]   =  data        & 0xFF;
            mem[off+1] = (data >>> 8) & 0xFF;
            break;
        case 0b010:
            mem[off]   =  data         & 0xFF;
            mem[off+1] = (data >>>  8) & 0xFF;
            mem[off+2] = (data >>> 16) & 0xFF;
            mem[off+3] = (data >>> 24) & 0xFF;
            break;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Empty pipeline register templates
// ══════════════════════════════════════════════════════════════════════════════

function emptyIFID() {
    return { pc: 0, instr: NOP_INSTR };
}

function emptyIDEX() {
    return {
        pc: 0, rs1_data: 0, rs2_data: 0, imm: 0,
        rs1_addr: 0, rs2_addr: 0, rd_addr: 0,
        alu_op: 0, alu_src_a: 0, alu_src_b: 0, PC_or_Rs1_mux: 0,
        mem_write: 0, mem_read: 0, wb_sel: 0, reg_write_en: 0,
        branch: 0, jump: 0, funct3: 0,
        // For display: the original instruction and PC from IF
        _instr: NOP_INSTR, _pc: 0, _bubble: true,
    };
}

function emptyEXMEM() {
    return {
        alu_result: 0, rs2_data: 0, pc_plus4: 0, rd_addr: 0,
        reg_write_en: 0, mem_write: 0, mem_read: 0, wb_sel: 0, funct3: 0,
        _instr: NOP_INSTR, _pc: 0, _bubble: true,
    };
}

function emptyMEMWB() {
    return {
        alu_result: 0, mem_data: 0, pc_plus4: 0, rd_addr: 0,
        reg_write_en: 0, wb_sel: 0,
        _instr: NOP_INSTR, _pc: 0, _bubble: true,
    };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PipelineCPU class
// ══════════════════════════════════════════════════════════════════════════════

export class PipelineCPU {
    constructor() {
        this.imem    = new Uint32Array(IMEM_WORDS);
        this.dmem    = new Uint8Array(DMEM_BYTES);
        this.regs    = new Uint32Array(32);
        this.pc      = BASE_ADDR >>> 0;
        this.halted  = false;
        this.history = [];

        // Pipeline registers
        this.ifid  = emptyIFID();
        this.idex  = emptyIDEX();
        this.exmem = emptyEXMEM();
        this.memwb = emptyMEMWB();
    }

    reset() {
        this.regs.fill(0);
        this.pc      = BASE_ADDR >>> 0;
        this.halted  = false;
        this.history = [];
        this.ifid    = emptyIFID();
        this.idex    = emptyIDEX();
        this.exmem   = emptyEXMEM();
        this.memwb   = emptyMEMWB();
    }

    loadProgram(words) {
        this.imem.fill(0);
        for (let i = 0; i < words.length && i < IMEM_WORDS; i++) {
            this.imem[i] = words[i] >>> 0;
        }
    }

    loadData(bytes, addrOffset) {
        for (let i = 0; i < bytes.length && (addrOffset + i) < DMEM_BYTES; i++) {
            this.dmem[addrOffset + i] = bytes[i] & 0xFF;
        }
    }

    // ── Save/restore for step-back ──────────────────────────────────────────
    _saveState() {
        return {
            pc:    this.pc,
            regs:  new Uint32Array(this.regs),
            dmem:  new Uint8Array(this.dmem),
            ifid:  { ...this.ifid },
            idex:  { ...this.idex },
            exmem: { ...this.exmem },
            memwb: { ...this.memwb },
        };
    }

    _restoreState(s) {
        this.pc    = s.pc;
        this.regs  = new Uint32Array(s.regs);
        this.dmem  = new Uint8Array(s.dmem);
        this.ifid  = { ...s.ifid };
        this.idex  = { ...s.idex };
        this.exmem = { ...s.exmem };
        this.memwb = { ...s.memwb };
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  step() — execute one pipeline cycle
    //  Order mirrors RTL: all stages read current pipeline regs, then we
    //  update all pipeline regs simultaneously (like a clock edge).
    // ══════════════════════════════════════════════════════════════════════════
    step() {
        if (this.halted) return null;

        // Save state for step-back
        if (this.history.length >= MAX_HISTORY) this.history.shift();
        this.history.push(this._saveState());

        const pc = this.pc >>> 0;

        // ══════════════════════════════════════════════════════════════════
        //  WB Stage (reads memwb, writes to regfile)
        // ══════════════════════════════════════════════════════════════════
        let wb_result;
        switch (this.memwb.wb_sel) {
            case 0b00: wb_result = this.memwb.pc_plus4;   break;
            case 0b01: wb_result = this.memwb.alu_result;  break;
            case 0b10: wb_result = this.memwb.mem_data;    break;
            default:   wb_result = this.memwb.alu_result;
        }
        wb_result = wb_result >>> 0;

        const wb_rd_addr      = this.memwb.rd_addr;
        const wb_reg_write_en = this.memwb.reg_write_en;

        // Write to register file (sequential — but we do it here before ID reads
        // because the regfile has internal WB→ID forwarding)
        if (wb_reg_write_en && wb_rd_addr !== 0) {
            this.regs[wb_rd_addr] = wb_result;
        }

        // ══════════════════════════════════════════════════════════════════
        //  MEM Stage (reads exmem, accesses dmem)
        // ══════════════════════════════════════════════════════════════════
        let mem_rd_data = 0;
        if (this.exmem.mem_read) {
            mem_rd_data = dmemRead(this.dmem, this.exmem.alu_result, this.exmem.funct3) >>> 0;
        }
        if (this.exmem.mem_write) {
            dmemWrite(this.dmem, this.exmem.alu_result, this.exmem.rs2_data, this.exmem.funct3);
        }

        // New MEM/WB register values
        const new_memwb = {
            alu_result:   this.exmem.alu_result,
            mem_data:     mem_rd_data,
            pc_plus4:     this.exmem.pc_plus4,
            rd_addr:      this.exmem.rd_addr,
            reg_write_en: this.exmem.reg_write_en,
            wb_sel:       this.exmem.wb_sel,
            _instr:       this.exmem._instr,
            _pc:          this.exmem._pc,
            _bubble:      this.exmem._bubble,
        };

        // ══════════════════════════════════════════════════════════════════
        //  EX Stage (reads idex, forwarding, ALU, branch logic)
        // ══════════════════════════════════════════════════════════════════

        // Forwarding unit
        const fwd = forwardingUnit(
            this.idex.rs1_addr, this.idex.rs2_addr,
            this.exmem.rd_addr, this.exmem.reg_write_en,
            this.memwb.rd_addr, this.memwb.reg_write_en
        );

        // Forwarding muxes for rs1/rs2
        let ex_rs1_data, ex_rs2_data;
        switch (fwd.forward_a) {
            case 0b01: ex_rs1_data = this.exmem.alu_result; break;
            case 0b10: ex_rs1_data = wb_result;             break;
            default:   ex_rs1_data = this.idex.rs1_data;
        }
        switch (fwd.forward_b) {
            case 0b01: ex_rs2_data = this.exmem.alu_result; break;
            case 0b10: ex_rs2_data = wb_result;              break;
            default:   ex_rs2_data = this.idex.rs2_data;
        }
        ex_rs1_data = ex_rs1_data >>> 0;
        ex_rs2_data = ex_rs2_data >>> 0;

        // ALU input muxes
        const alu_a = (this.idex.alu_src_a ? this.idex.pc : ex_rs1_data) >>> 0;
        const alu_b = (this.idex.alu_src_b ? this.idex.imm : ex_rs2_data) >>> 0;

        // ALU
        const ex_alu_result = alu(this.idex.alu_op, alu_a, alu_b);

        // Branch target
        const ex_pc_plus_imm = ((this.idex.pc >>> 0) + (this.idex.imm | 0)) >>> 0;
        const branch_target  = this.idex.PC_or_Rs1_mux ? ex_alu_result : ex_pc_plus_imm;

        // PC+4 for JAL/JALR return address
        const ex_pc_plus4 = (this.idex.pc + 4) >>> 0;

        // Branch logic
        const pc_src = branchLogic(ex_alu_result, this.idex.funct3, this.idex.branch, this.idex.jump);

        // New EX/MEM register values
        const new_exmem = {
            alu_result:   ex_alu_result,
            rs2_data:     ex_rs2_data,   // post-forwarding (for stores)
            pc_plus4:     ex_pc_plus4,
            rd_addr:      this.idex.rd_addr,
            reg_write_en: this.idex.reg_write_en,
            mem_write:    this.idex.mem_write,
            mem_read:     this.idex.mem_read,
            wb_sel:       this.idex.wb_sel,
            funct3:       this.idex.funct3,
            _instr:       this.idex._instr,
            _pc:          this.idex._pc,
            _bubble:      this.idex._bubble,
        };

        // ══════════════════════════════════════════════════════════════════
        //  ID Stage (reads ifid, field extract, decode, regfile read)
        // ══════════════════════════════════════════════════════════════════
        const id_fields = fieldExtract(this.ifid.instr);
        const id_imm    = (immGen(this.ifid.instr, id_fields.opcode)) >>> 0;
        const id_ctrl   = decode(id_fields.opcode, id_fields.funct3, id_fields.funct7);

        // Regfile read with WB→ID internal forwarding
        let id_rs1_data = (id_fields.rs1 === 0) ? 0 : this.regs[id_fields.rs1];
        let id_rs2_data = (id_fields.rs2 === 0) ? 0 : this.regs[id_fields.rs2];

        // Internal forwarding: if WB is writing to the same register ID is reading
        if (wb_reg_write_en && wb_rd_addr !== 0 && wb_rd_addr === id_fields.rs1) {
            id_rs1_data = wb_result;
        }
        if (wb_reg_write_en && wb_rd_addr !== 0 && wb_rd_addr === id_fields.rs2) {
            id_rs2_data = wb_result;
        }
        id_rs1_data = id_rs1_data >>> 0;
        id_rs2_data = id_rs2_data >>> 0;

        // Hazard detection (load-use)
        const stall = hazardUnit(this.idex.rd_addr, this.idex.mem_read, id_fields.rs1, id_fields.rs2);

        // Ecall detection — ecall in ID stage
        const is_ecall_in_id = (id_fields.opcode === 0x73);

        // New ID/EX register values
        let new_idex;
        if (stall || pc_src) {
            // Bubble: flush control signals
            new_idex = emptyIDEX();
        } else {
            new_idex = {
                pc:            this.ifid.pc,
                rs1_data:      id_rs1_data,
                rs2_data:      id_rs2_data,
                imm:           id_imm,
                rs1_addr:      id_fields.rs1,
                rs2_addr:      id_fields.rs2,
                rd_addr:       id_fields.rd,
                alu_op:        id_ctrl.alu_op,
                alu_src_a:     id_ctrl.alu_src_mux_1,
                alu_src_b:     id_ctrl.alu_src_mux_2,
                PC_or_Rs1_mux: id_ctrl.PC_or_Rs1_mux,
                mem_write:     id_ctrl.dmem_wr_en,
                mem_read:      id_ctrl.dmem_rd_en,
                wb_sel:        id_ctrl.writeback_mux,
                reg_write_en:  id_ctrl.reg_write_en,
                branch:        id_ctrl.branch,
                jump:          id_ctrl.jump,
                funct3:        id_fields.funct3,
                _instr:        this.ifid.instr,
                _pc:           this.ifid.pc,
                _bubble:       false,
            };
        }

        // ══════════════════════════════════════════════════════════════════
        //  IF Stage (fetch instruction, compute next PC)
        // ══════════════════════════════════════════════════════════════════
        const imemIdx  = (pc - 0x80000000) >>> 2;
        const if_instr = (imemIdx < IMEM_WORDS) ? this.imem[imemIdx] : 0;
        const pc_next  = pc_src ? branch_target : (pc + 4) >>> 0;

        // New IF/ID register values
        let new_ifid;
        if (pc_src) {
            // Flush: branch/jump taken — insert NOP
            new_ifid = emptyIFID();
        } else if (stall) {
            // Stall: freeze IF/ID
            new_ifid = { ...this.ifid };
        } else {
            new_ifid = { pc, instr: if_instr };
        }

        // ══════════════════════════════════════════════════════════════════
        //  Clock edge — update all pipeline registers and PC simultaneously
        // ══════════════════════════════════════════════════════════════════
        const old_ifid  = { ...this.ifid };
        const old_idex  = { ...this.idex };
        const old_exmem = { ...this.exmem };
        const old_memwb = { ...this.memwb };

        this.memwb = new_memwb;
        this.exmem = new_exmem;
        this.idex  = new_idex;
        this.ifid  = new_ifid;

        // Update PC
        if (!stall) {
            this.pc = pc_next;
        }

        // Ecall detection: halt when ecall reaches WB
        // (ecall progresses through the pipeline like any instruction)
        if (old_memwb._instr === 0x00000073 && !old_memwb._bubble) {
            this.halted = true;
        }

        // ══════════════════════════════════════════════════════════════════
        //  Build snapshot for visualizer
        // ══════════════════════════════════════════════════════════════════
        return {
            // Current PC (before update for display)
            pc,
            pc_next: stall ? pc : pc_next,

            // IF stage
            if_stage: {
                pc,
                instr: if_instr,
                pc_next: stall ? pc : pc_next,
            },

            // ID stage (uses old IF/ID — what was being decoded this cycle)
            id_stage: {
                pc:       old_ifid.pc,
                instr:    old_ifid.instr,
                fields:   id_fields,
                imm:      id_imm,
                ctrl:     id_ctrl,
                rs1_data: id_rs1_data,
                rs2_data: id_rs2_data,
            },

            // EX stage (uses old ID/EX — what was executing this cycle)
            ex_stage: {
                pc:          old_idex.pc,
                instr:       old_idex._instr,
                bubble:      old_idex._bubble,
                rs1_data:    ex_rs1_data,
                rs2_data:    ex_rs2_data,
                alu_a,
                alu_b,
                alu_result:  ex_alu_result,
                branch_target,
                pc_plus_imm: ex_pc_plus_imm,
                pc_plus4:    ex_pc_plus4,
                pc_src,
                forward_a:   fwd.forward_a,
                forward_b:   fwd.forward_b,
                // Control signals from ID/EX
                alu_op:      old_idex.alu_op,
                alu_src_a:   old_idex.alu_src_a,
                alu_src_b:   old_idex.alu_src_b,
                branch:      old_idex.branch,
                jump:        old_idex.jump,
                funct3:      old_idex.funct3,
                rd_addr:     old_idex.rd_addr,
                mem_read:    old_idex.mem_read,
                mem_write:   old_idex.mem_write,
                wb_sel:      old_idex.wb_sel,
                reg_write_en:old_idex.reg_write_en,
                PC_or_Rs1_mux: old_idex.PC_or_Rs1_mux,
            },

            // MEM stage (uses old EX/MEM — what was accessing memory this cycle)
            mem_stage: {
                pc:          old_exmem._pc,
                instr:       old_exmem._instr,
                bubble:      old_exmem._bubble,
                alu_result:  old_exmem.alu_result,
                rs2_data:    old_exmem.rs2_data,
                mem_rd_data,
                mem_write:   old_exmem.mem_write,
                mem_read:    old_exmem.mem_read,
                funct3:      old_exmem.funct3,
                rd_addr:     old_exmem.rd_addr,
                wb_sel:      old_exmem.wb_sel,
                reg_write_en:old_exmem.reg_write_en,
                pc_plus4:    old_exmem.pc_plus4,
            },

            // WB stage (uses old MEM/WB — what was writing back this cycle)
            wb_stage: {
                pc:          old_memwb._pc,
                instr:       old_memwb._instr,
                bubble:      old_memwb._bubble,
                result:      wb_result,
                rd_addr:     wb_rd_addr,
                reg_write_en:wb_reg_write_en,
                wb_sel:      old_memwb.wb_sel,
                alu_result:  old_memwb.alu_result,
                mem_data:    old_memwb.mem_data,
                pc_plus4:    old_memwb.pc_plus4,
            },

            // Pipeline register snapshots (after clock edge — new state)
            pipe_regs: {
                ifid:  { ...this.ifid },
                idex:  { ...this.idex },
                exmem: { ...this.exmem },
                memwb: { ...this.memwb },
            },

            // Hazard/control status
            stall,
            flush:       pc_src,
            is_ecall:    is_ecall_in_id,
            halted:      this.halted,

            // Register file snapshot
            regs: new Uint32Array(this.regs),
        };
    }

    stepBack() {
        if (this.history.length === 0) return false;
        this._restoreState(this.history.pop());
        this.halted = false;
        return true;
    }

    canStepBack() {
        return this.history.length > 0;
    }
}
