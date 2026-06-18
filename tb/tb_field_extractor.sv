module tb_field_extractor;

    logic [31:0] instr;

    logic [6:0]  opcode;
    logic [4:0]  rd;
    logic [2:0]  funct3;
    logic [4:0]  rs1;
    logic [4:0]  rs2;
    logic [6:0]  funct7;

    field_extractor dut (
        .instr  (instr),
        .opcode (opcode),
        .rd     (rd),
        .funct3 (funct3),
        .rs1    (rs1),
        .rs2    (rs2),
        .funct7 (funct7)
    );

    initial begin
        // Format: instr = {funct7, rs2, rs1, funct3, rd, opcode}

        // Test 1: all distinct values, easy to spot if a field is wrong
        instr = {7'b0000001, 5'b00010, 5'b00011, 3'b001, 5'b00100, 7'b0110011};
        #1;
        $display("Test 1:");
        $display("  opcode=%b (exp 0110011)", opcode);
        $display("  rd    =%b (exp 00100)",   rd);
        $display("  funct3=%b (exp 001)",      funct3);
        $display("  rs1   =%b (exp 00011)",    rs1);
        $display("  rs2   =%b (exp 00010)",    rs2);
        $display("  funct7=%b (exp 0000001)",  funct7);

        // Test 2: all zeros
        instr = 32'b0;
        #1;
        $display("Test 2 (all zeros): opcode=%b rd=%b funct3=%b rs1=%b rs2=%b funct7=%b",
                 opcode, rd, funct3, rs1, rs2, funct7);

        // Test 3: all ones
        instr = 32'hFFFFFFFF;
        #1;
        $display("Test 3 (all ones): opcode=%b rd=%b funct3=%b rs1=%b rs2=%b funct7=%b",
                 opcode, rd, funct3, rs1, rs2, funct7);

        $finish;
    end

endmodule
