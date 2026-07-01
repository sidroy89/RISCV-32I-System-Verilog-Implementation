module tb_imem;

    logic [31:0] pc;
    logic [31:0] instr;

    imem dut (
        .pc    (pc),
        .instr (instr)
    );

    initial begin
        // PC = 0 -> word 0 -> expect addi x1, x0, 5 = 0x00500093
        pc = 32'h0; #1;
        if (instr === 32'h00500093)
            $display("PASS: pc=0 instr=%h (addi x1,x0,5)", instr);
        else
            $display("FAIL: pc=0 got %h (exp 00500093)", instr);

        // PC = 4 -> word 1 -> expect addi x2, x0, 10 = 0x00A00113
        pc = 32'h4; #1;
        if (instr === 32'h00A00113)
            $display("PASS: pc=4 instr=%h (addi x2,x0,10)", instr);
        else
            $display("FAIL: pc=4 got %h (exp 00A00113)", instr);

        // PC = 8 -> word 2 -> expect add x3, x1, x2 = 0x002081B3
        pc = 32'h8; #1;
        if (instr === 32'h002081B3)
            $display("PASS: pc=8 instr=%h (add x3,x1,x2)", instr);
        else
            $display("FAIL: pc=8 got %h (exp 002081B3)", instr);

        $finish;
    end

endmodule
