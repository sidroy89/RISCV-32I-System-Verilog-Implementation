// datapath_pipe.sv
// 5-stage pipelined datapath: IF -> ID -> EX -> MEM -> WB
// Pipeline registers: IF/ID, ID/EX, EX/MEM, MEM/WB
// Includes: forwarding unit, hazard unit, branch/jump flush logic

module datapath_pipe (
    input logic clk,
    input logic rst
);

    // =========================================================================
    // Forward declarations (used before their driving logic)
    // =========================================================================
    logic stall;                      // from hazard_unit (used in IF, ID/EX)
    logic branch_logic_pc_src;        // from branch_logic in EX (used in IF/ID flush)
    logic [31:0] branch_logic_target; // from EX stage (used in PC mux)
    logic [31:0] exmem_alu_result;    // from EX/MEM reg (used in forwarding muxes)
    logic [31:0] memwb_result;        // from WB stage (used in forwarding muxes)
    logic [4:0]  exmem_rd_addr;
    logic        exmem_reg_write_en;
    logic [4:0]  memwb_rd_addr;
    logic        memwb_reg_write_en;

    // =========================================================================
    // IF Stage
    // =========================================================================
    logic [31:0] pc, pc_next;
    logic [31:0] if_instr;          // instruction from imem
    // PC register
    always_ff @(posedge clk) begin
        if (rst)
            pc <= 32'h80000000;
        else if (!stall)
            pc <= pc_next;
    end

    // Instruction memory
    imem imem_inst (
        .pc    (pc),
        .instr (if_instr)
    );

    // PC mux: choose between PC+4 (sequential) and branch/jump target (from EX branch_logic)
    assign pc_next = branch_logic_pc_src ? branch_logic_target : (pc + 32'd4);

    // -------------------------------------------------------------------------
    // IF/ID Pipeline Register
    // -------------------------------------------------------------------------
    logic [31:0] ifid_pc;
    logic [31:0] ifid_instr;

    always_ff @(posedge clk) begin
        if (rst || branch_logic_pc_src) begin        // reset or flush on branch/jump taken
            ifid_pc    <= 32'b0;
            ifid_instr <= 32'h00000013; // NOP: addi x0, x0, 0
        end else if (!stall) begin
            ifid_pc    <= pc;
            ifid_instr <= if_instr;
        end
    end

    // =========================================================================
    // ID Stage
    // =========================================================================

    // Field extractor outputs
    logic [6:0] id_opcode;
    logic [4:0] id_rs1_addr, id_rs2_addr, id_rd_addr;
    logic [2:0] id_funct3;
    logic [6:0] id_funct7;

    field_extractor fe_inst (
        .instr  (ifid_instr),
        .opcode (id_opcode),
        .rs1    (id_rs1_addr),
        .rs2    (id_rs2_addr),
        .rd     (id_rd_addr),
        .funct3 (id_funct3),
        .funct7 (id_funct7)
    );

    // Immediate generator
    logic [31:0] id_imm;

    imm_gen imm_gen_inst (
        .instr (ifid_instr),
        .imm   (id_imm)
    );

    // Decoder / control unit
    logic [1:0] id_wb_sel;
    logic       id_reg_write_en;
    logic       id_alu_src_a;       // 0=rs1, 1=PC
    logic       id_alu_src_b;       // 0=rs2, 1=imm
    logic       id_PC_or_Rs1_mux;   // 0=PC, 1=rs1 (for JALR target)
    logic [3:0] id_alu_op;
    logic       id_branch;
    logic       id_jump;
    logic       id_mem_write;
    logic       id_mem_read;

    decoder dec_inst (
        .opcode        (id_opcode),
        .funct3        (id_funct3),
        .funct7        (id_funct7),
        .writeback_mux (id_wb_sel),
        .reg_write_en  (id_reg_write_en),
        .PC_or_Rs1_mux (id_PC_or_Rs1_mux),
        .alu_src_mux_1 (id_alu_src_a),
        .alu_src_mux_2 (id_alu_src_b),
        .alu_op        (id_alu_op),
        .branch        (id_branch),
        .jump          (id_jump),
        .dmem_wr_en    (id_mem_write),
        .dmem_rd_en    (id_mem_read)
    );

    // Register file
    logic [31:0] id_rs1_data, id_rs2_data;
    // Write port signals come from WB stage (declared later)
    logic [4:0]  wb_rd_addr;
    logic [31:0] wb_rd_data;
    logic        wb_reg_write_en;

    regfile rf_inst (
        .clk          (clk),
        .rs1_addr     (id_rs1_addr),
        .rs2_addr     (id_rs2_addr),
        .rd_addr      (wb_rd_addr),
        .rd_data      (wb_rd_data),
        .reg_write_en (wb_reg_write_en),
        .rs1_data     (id_rs1_data),
        .rs2_data     (id_rs2_data)
    );

    // -------------------------------------------------------------------------
    // ID/EX Pipeline Register
    // -------------------------------------------------------------------------
    // Data
    logic [31:0] idex_pc;
    logic [31:0] idex_rs1_data, idex_rs2_data;
    logic [31:0] idex_imm;
    logic [4:0]  idex_rs1_addr, idex_rs2_addr, idex_rd_addr;
    // Control
    logic [3:0]  idex_alu_op;
    logic        idex_alu_src_a, idex_alu_src_b;
    logic        idex_PC_or_Rs1_mux;
    logic        idex_mem_write, idex_mem_read;
    logic [1:0]  idex_wb_sel;
    logic        idex_reg_write_en;
    logic        idex_branch, idex_jump;
    logic [2:0]  idex_funct3;

    always_ff @(posedge clk) begin
        if (rst || stall || branch_logic_pc_src) begin
            // bubble: zero all control signals so EX does nothing
            idex_pc           <= 32'b0;
            idex_rs1_data     <= 32'b0;
            idex_rs2_data     <= 32'b0;
            idex_imm          <= 32'b0;
            idex_rs1_addr     <= 5'b0;
            idex_rs2_addr     <= 5'b0;
            idex_rd_addr      <= 5'b0;
            idex_alu_op       <= 4'b0;
            idex_alu_src_a    <= 1'b0;
            idex_alu_src_b    <= 1'b0;
            idex_PC_or_Rs1_mux <= 1'b0;
            idex_mem_write    <= 1'b0;
            idex_mem_read     <= 1'b0;
            idex_wb_sel       <= 2'b0;
            idex_reg_write_en <= 1'b0;
            idex_branch       <= 1'b0;
            idex_jump         <= 1'b0;
            idex_funct3       <= 3'b0;
        end else begin
            idex_pc           <= ifid_pc;
            idex_rs1_data     <= id_rs1_data;
            idex_rs2_data     <= id_rs2_data;
            idex_imm          <= id_imm;
            idex_rs1_addr     <= id_rs1_addr;
            idex_rs2_addr     <= id_rs2_addr;
            idex_rd_addr      <= id_rd_addr;
            idex_alu_op       <= id_alu_op;
            idex_alu_src_a    <= id_alu_src_a;
            idex_alu_src_b    <= id_alu_src_b;
            idex_PC_or_Rs1_mux <= id_PC_or_Rs1_mux;
            idex_mem_write    <= id_mem_write;
            idex_mem_read     <= id_mem_read;
            idex_wb_sel       <= id_wb_sel;
            idex_reg_write_en <= id_reg_write_en;
            idex_branch       <= id_branch;
            idex_jump         <= id_jump;
            idex_funct3       <= id_funct3;
        end
    end

    // =========================================================================
    // EX Stage
    // =========================================================================

    // Forwarding unit outputs
    logic [1:0] forward_a, forward_b;

    // 3:1 forwarding muxes — pick correct rs1/rs2 value
    // 00=no fwd (use ID/EX), 01=fwd from EX/MEM, 10=fwd from MEM/WB
    logic [31:0] ex_rs1_data, ex_rs2_data;
    // exmem_alu_result and memwb_result declared at top

    always_comb begin
        case (forward_a)
            2'b01:   ex_rs1_data = exmem_alu_result;
            2'b10:   ex_rs1_data = memwb_result;
            default: ex_rs1_data = idex_rs1_data;
        endcase

        case (forward_b)
            2'b01:   ex_rs2_data = exmem_alu_result;
            2'b10:   ex_rs2_data = memwb_result;
            default: ex_rs2_data = idex_rs2_data;
        endcase
    end

    // ALU input muxes
    logic [31:0] alu_a, alu_b;

    // Input A: forwarded rs1 or PC (for AUIPC)
    assign alu_a = idex_alu_src_a ? idex_pc : ex_rs1_data;

    // Input B: forwarded rs2 or immediate
    assign alu_b = idex_alu_src_b ? idex_imm : ex_rs2_data;

    // ALU
    logic [31:0] ex_alu_result;

    alu alu_inst (
        .alu_ctrl (idex_alu_op),
        .a        (alu_a),
        .b        (alu_b),
        .result   (ex_alu_result),
        .zero     ()   // unused in pipeline
    );

    // Branch target adder: PC + imm (for branches and JAL)
    logic [31:0] ex_pc_plus_imm;
    assign ex_pc_plus_imm = idex_pc + idex_imm;

    // Target mux: PC+imm (branches/JAL) or ALU result (JALR: rs1+imm)
    assign branch_logic_target = idex_PC_or_Rs1_mux ? ex_alu_result : ex_pc_plus_imm;

    // PC+4 for writeback (JAL/JALR return address)
    logic [31:0] ex_pc_plus4;
    assign ex_pc_plus4 = idex_pc + 32'd4;

    // Branch logic: determines if branch/jump is taken
    branch_logic bl_inst (
        .alu_result (ex_alu_result),
        .funct3     (idex_funct3),
        .branch     (idex_branch),
        .jump       (idex_jump),
        .pc_src     (branch_logic_pc_src)
    );

    // Hazard detection unit — detects load-use hazards, generates stall
    hazard_unit haz_inst (
        .idex_rd_addr  (idex_rd_addr),
        .idex_mem_read (idex_mem_read),
        .rs1_addr      (id_rs1_addr),
        .rs2_addr      (id_rs2_addr),
        .stall         (stall)
    );

    // Forwarding unit — generates mux select signals for rs1/rs2 forwarding
    // exmem_rd_addr, exmem_reg_write_en, memwb_rd_addr, memwb_reg_write_en declared at top
    forwarding_unit fwd_inst (
        .rs1_addr          (idex_rs1_addr),
        .rs2_addr          (idex_rs2_addr),
        .exmem_rd_addr     (exmem_rd_addr),
        .exmem_reg_write_en(exmem_reg_write_en),
        .memwb_rd_addr     (memwb_rd_addr),
        .memwb_reg_write_en(memwb_reg_write_en),
        .forward_a         (forward_a),
        .forward_b         (forward_b)
    );

    // -------------------------------------------------------------------------
    // EX/MEM Pipeline Register
    // -------------------------------------------------------------------------
    // Data
    // exmem_alu_result and exmem_rd_addr already declared above (used by forwarding unit)
    logic [31:0] exmem_rs2_data;
    logic [31:0] exmem_pc_plus4;
    // Control
    // exmem_reg_write_en already declared above
    logic        exmem_mem_write, exmem_mem_read;
    logic [1:0]  exmem_wb_sel;
    logic [2:0]  exmem_funct3;

    always_ff @(posedge clk) begin
        if (rst) begin
            exmem_alu_result    <= 32'b0;
            exmem_rs2_data      <= 32'b0;
            exmem_pc_plus4      <= 32'b0;
            exmem_rd_addr       <= 5'b0;
            exmem_reg_write_en  <= 1'b0;
            exmem_mem_write     <= 1'b0;
            exmem_mem_read      <= 1'b0;
            exmem_wb_sel        <= 2'b0;
            exmem_funct3        <= 3'b0;
        end else begin
            exmem_alu_result    <= ex_alu_result;
            exmem_rs2_data      <= ex_rs2_data;   // post-forwarding rs2 for stores
            exmem_pc_plus4      <= ex_pc_plus4;
            exmem_rd_addr       <= idex_rd_addr;
            exmem_reg_write_en  <= idex_reg_write_en;
            exmem_mem_write     <= idex_mem_write;
            exmem_mem_read      <= idex_mem_read;
            exmem_wb_sel        <= idex_wb_sel;
            exmem_funct3        <= idex_funct3;
        end
    end

    // =========================================================================
    // MEM Stage
    // =========================================================================
    logic [31:0] mem_rd_data;

    dmem #(.MEM_SIZE(16384)) dmem_inst (
        .clk     (clk),
        .addr    (exmem_alu_result),
        .wr_data (exmem_rs2_data),
        .we      (exmem_mem_write),
        .re      (exmem_mem_read),
        .funct3  (exmem_funct3),
        .rd_data (mem_rd_data)
    );

    // -------------------------------------------------------------------------
    // MEM/WB Pipeline Register
    // -------------------------------------------------------------------------
    // Data
    // memwb_rd_addr and memwb_reg_write_en already declared above (used by forwarding unit)
    logic [31:0] memwb_alu_result;
    logic [31:0] memwb_mem_data;
    logic [31:0] memwb_pc_plus4;
    // Control
    logic [1:0]  memwb_wb_sel;

    always_ff @(posedge clk) begin
        if (rst) begin
            memwb_alu_result   <= 32'b0;
            memwb_mem_data     <= 32'b0;
            memwb_pc_plus4     <= 32'b0;
            memwb_rd_addr      <= 5'b0;
            memwb_reg_write_en <= 1'b0;
            memwb_wb_sel       <= 2'b0;
        end else begin
            memwb_alu_result   <= exmem_alu_result;
            memwb_mem_data     <= mem_rd_data;
            memwb_pc_plus4     <= exmem_pc_plus4;
            memwb_rd_addr      <= exmem_rd_addr;
            memwb_reg_write_en <= exmem_reg_write_en;
            memwb_wb_sel       <= exmem_wb_sel;
        end
    end

    // =========================================================================
    // WB Stage
    // =========================================================================

    // Writeback mux: 00=PC+4, 01=ALU result, 10=mem data
    always_comb begin
        case (memwb_wb_sel)
            2'b00:   memwb_result = memwb_pc_plus4;
            2'b01:   memwb_result = memwb_alu_result;
            2'b10:   memwb_result = memwb_mem_data;
            default: memwb_result = memwb_alu_result;
        endcase
    end

    // Feed writeback signals back to regfile
    assign wb_rd_addr      = memwb_rd_addr;
    assign wb_rd_data      = memwb_result;
    assign wb_reg_write_en = memwb_reg_write_en;

endmodule
