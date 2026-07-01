module tb_alu;

    logic [3:0]  alu_ctrl;
    logic [31:0] a, b;
    logic [31:0] result;
    logic        zero;

    alu dut (
        .alu_ctrl (alu_ctrl),
        .a        (a),
        .b        (b),
        .result   (result),
        .zero     (zero)
    );

    task check;
        input [31:0] expected;
        input        exp_zero;
        if (result === expected && zero === exp_zero)
            $display("PASS: ctrl=%b a=%0d b=%0d result=%0d zero=%b", alu_ctrl, $signed(a), $signed(b), $signed(result), zero);
        else
            $display("FAIL: ctrl=%b a=%0d b=%0d got result=%0d zero=%b | exp result=%0d zero=%b",
                     alu_ctrl, $signed(a), $signed(b), $signed(result), zero, $signed(expected), exp_zero);
    endtask

    initial begin
        // ADD
        alu_ctrl = 4'b0000; a = 10;  b = 5;  #1; check(15, 0);
        alu_ctrl = 4'b0000; a = 0;   b = 0;  #1; check(0,  1);  // zero flag

        // SUB
        alu_ctrl = 4'b0001; a = 10;  b = 10; #1; check(0,  1);  // zero flag
        alu_ctrl = 4'b0001; a = 10;  b = 3;  #1; check(7,  0);

        // AND
        alu_ctrl = 4'b0010; a = 32'hFF; b = 32'h0F; #1; check(32'h0F, 0);

        // OR
        alu_ctrl = 4'b0011; a = 32'hF0; b = 32'h0F; #1; check(32'hFF, 0);

        // XOR
        alu_ctrl = 4'b0100; a = 32'hFF; b = 32'hFF; #1; check(0, 1);

        // SLL
        alu_ctrl = 4'b0101; a = 1; b = 4; #1; check(16, 0);

        // SRL
        alu_ctrl = 4'b0110; a = 32'hF0000000; b = 4; #1; check(32'h0F000000, 0);

        // SRA (arithmetic — sign bit should be preserved)
        alu_ctrl = 4'b0111; a = 32'hF0000000; b = 4; #1; check(32'hFF000000, 0);

        // SLT signed: -1 < 1 = true
        alu_ctrl = 4'b1000; a = -1; b = 1; #1; check(1, 0);
        // SLT signed: 1 < -1 = false
        alu_ctrl = 4'b1000; a = 1;  b = -1; #1; check(0, 1);

        // SLTU unsigned: 0xFFFFFFFF > 1, so not less than
        alu_ctrl = 4'b1001; a = 32'hFFFFFFFF; b = 1; #1; check(0, 1);
        // SLTU unsigned: 1 < 0xFFFFFFFF = true
        alu_ctrl = 4'b1001; a = 1; b = 32'hFFFFFFFF; #1; check(1, 0);

        $finish;
    end

endmodule
