module imm_gen (
    input  logic [31:0] instr,
    output logic [31:0] imm
);

    logic [6:0] opcode;
    assign opcode = instr[6:0];

    always_comb begin
        case (opcode)
            7'b0000011,         // I-type: loads
            7'b0010011,         // I-type: OP-IMM (addi, ori, andi...)
            7'b1100111: begin   // I-type: jalr
                imm = {{20{instr[31]}}, instr[31:20]};  // in I type intrscution its bits 31:20
            end

            7'b0100011: begin   // S-type: stores
                imm = {{20{instr[31]}}, instr[31:25], instr[11:7]};  // in S type intrscution its bits 31:25 and 11:7 cocatenated together
            end

            7'b1100011: begin   // B-type: branches
                imm = {{19{instr[31]}}, instr[31], instr[7], instr[30:25],instr[11:8], 1'b0};  // in B type intrscution its bits 31, 7, 30:25 and 11:8 cocatenated together and shifted left by 1 (multiplied by 2)
                // the 0th but is a mutkpe of 2 beacue all sintruction are 4 bytes so a vlaid isntruction has to have last 2 bits 0 BUT RISCV has compressed 
                // 2 byte isntructon so to supposrt that 
            end

            7'b0110111,         // U-type: lui
            7'b0010111: begin   // U-type: auipc
                imm = {instr[31:12], 12'b0};  // in U type intrscution its bits 31:12 and then 12 zeros
            end

            7'b1101111: begin   // J-type: jal
                imm = {{11{instr[31]}}, instr[31], instr[19:12], instr[20], instr[30:21], 1'b0};  // in J type intrscution its bits 31, 19:12, 20 and 11:8 cocatenated together and shifted left by 1 (multiplied by 2)
                // the 0th but is a mutkpe of 2 beacue all sintruction are 4 bytes so a vlaid isntruction has to have last 2 bits 0 BUT RISCV has compressed 
                // 2 byte isntructon so to supposrt that 
            end

            default: imm = 32'b0;
        endcase
    end

endmodule
