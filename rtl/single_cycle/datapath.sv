module datapath (
    input  logic        clk,
    input  logic        rst
);

    
    // PC
    logic [31:0] pc, pc_next, pc_plus4, pc_target;

    // Instruction and fields
    logic [31:0] instr;
    logic [6:0]  opcode;
    logic [4:0]  rd, rs1, rs2;
    logic [2:0]  funct3;
    logic [6:0]  funct7;
    logic [31:0] imm;

    // Register file
    logic [31:0] rs1_data, rs2_data;
    logic [31:0] wb_data;

    // ALU
    logic [31:0] alu_a, alu_b, alu_result;
    logic        alu_zero;

    // Data memory
    logic [31:0] dmem_rdata;

    // Control signals from decoder
    logic [1:0]  writeback_mux;
    logic        reg_write_en;
    logic        PC_or_Rs1_mux;
    logic        alu_src_mux_1;
    logic        alu_src_mux_2;
    logic [3:0]  alu_op;
    logic        branch;
    logic        jump;
    logic        dmem_wr_en;
    logic        dmem_rd_en;

    // Branch/jump
    logic        pc_src;

    // -------------------------------------------------------------------------
    // PC register
    // -------------------------------------------------------------------------
    always_ff @(posedge clk) begin
        if (rst)
            pc <= 32'h80000000;
        else
            pc <= pc_next;
    end

    // -------------------------------------------------------------------------
    // PC adders and next PC mux
    // -------------------------------------------------------------------------
    assign pc_plus4  = pc + 32'd4;
    assign pc_target = (PC_or_Rs1_mux ? rs1_data : pc) + imm;  // PC+imm or rs1+imm
    assign pc_next   = pc_src ? pc_target : pc_plus4;

    // -------------------------------------------------------------------------
    // Module instantiations
    // -------------------------------------------------------------------------

    imem imem_inst (
        .pc    (pc),
        .instr (instr)
    );

    field_extractor fe_inst (
        .instr  (instr),
        .opcode (opcode),
        .rd     (rd),
        .funct3 (funct3),
        .rs1    (rs1),
        .rs2    (rs2),
        .funct7 (funct7)
    );

    imm_gen imm_gen_inst (
        .instr (instr),
        .imm   (imm)
    );

    decoder dec_inst (
        .opcode       (opcode),
        .funct3       (funct3),
        .funct7       (funct7),
        .writeback_mux (writeback_mux),
        .reg_write_en (reg_write_en),
        .PC_or_Rs1_mux(PC_or_Rs1_mux),
        .alu_src_mux_1(alu_src_mux_1),
        .alu_src_mux_2(alu_src_mux_2),
        .alu_op       (alu_op),
        .branch       (branch),
        .jump         (jump),
        .dmem_wr_en   (dmem_wr_en),
        .dmem_rd_en   (dmem_rd_en)
    );

    regfile rf_inst (
        .clk          (clk),
        .rs1_addr     (rs1),
        .rs2_addr     (rs2),
        .rd_addr      (rd),
        .rd_data      (wb_data),
        .reg_write_en (reg_write_en),
        .rs1_data     (rs1_data),
        .rs2_data     (rs2_data)
    );

    // ALU input muxes
    assign alu_a = alu_src_mux_1 ? pc       : rs1_data;
    assign alu_b = alu_src_mux_2 ? imm      : rs2_data;

    alu alu_inst (
        .alu_ctrl (alu_op),
        .a        (alu_a),
        .b        (alu_b),
        .result   (alu_result),
        .zero     (alu_zero)
    );

    dmem #(.MEM_SIZE(16384)) dmem_inst (
        .clk     (clk),
        .addr    (alu_result),
        .wr_data (rs2_data),
        .we      (dmem_wr_en),
        .re      (dmem_rd_en),
        .funct3  (funct3),
        .rd_data (dmem_rdata)
    );

    branch_logic bl_inst (
        .alu_result (alu_result),
        .funct3     (funct3),
        .branch     (branch),
        .jump       (jump),
        .pc_src     (pc_src)
    );

    // Writeback mux: 00=PC+4, 01=ALU result, 10=memory data
    always_comb begin
        case (writeback_mux)
            2'b00:   wb_data = pc_plus4;
            2'b01:   wb_data = alu_result;
            2'b10:   wb_data = dmem_rdata;
            default: wb_data = alu_result;
        endcase
    end

endmodule
