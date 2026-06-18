module branch_logic (
    input  logic [31:0] alu_result, // result from ALU (rs1 op rs2)
    input  logic [2:0]  funct3,     // branch type: beq, bne, blt, bge, bltu, bgeu
    input  logic        branch,     // 1 if this is a conditional branch instruction
    input  logic        jump,       // 1 if this is jal or jalr
    output logic        pc_src      // 1 = take branch/jump, 0 = PC+4
);

    logic branch_taken;

    always_comb begin
        branch_taken = 1'b0;  // default
        pc_src       = 1'b0;  // default
        if (jump) begin
            pc_src = 1'b1;
        end else if (branch) begin
            case (funct3)
                3'b000: branch_taken = (alu_result == 32'b0);        // beq:  rs1 == rs2
                3'b001: branch_taken = (alu_result != 32'b0);        // bne:  rs1 != rs2
                3'b100: branch_taken = (alu_result == 32'd1);        // blt:  rs1 < rs2 (signed)
                3'b101: branch_taken = (alu_result == 32'b0);        // bge:  rs1 >= rs2 (signed)
                3'b110: branch_taken = (alu_result == 32'd1);        // bltu: rs1 < rs2 (unsigned)
                3'b111: branch_taken = (alu_result == 32'b0);        // bgeu: rs1 >= rs2 (unsigned)
                default: branch_taken = 1'b0;
            endcase
            pc_src = branch_taken;
        end else begin
            pc_src = 1'b0;
        end
    end

endmodule