module tb_branch_logic;

    logic [31:0] alu_result;
    logic [2:0]  funct3;
    logic        branch;
    logic        jump;
    logic        pc_src;

    branch_logic dut (
        .alu_result (alu_result),
        .funct3     (funct3),
        .branch     (branch),
        .jump       (jump),
        .pc_src     (pc_src)
    );

    task check;
        input exp_pc_src;
        input [63:0] test_name; // unused, just for display
        if (pc_src === exp_pc_src)
            $display("PASS: funct3=%b branch=%b jump=%b alu=%0d -> pc_src=%b", funct3, branch, jump, $signed(alu_result), pc_src);
        else
            $display("FAIL: funct3=%b branch=%b jump=%b alu=%0d -> got pc_src=%b (exp %b)", funct3, branch, jump, $signed(alu_result), pc_src, exp_pc_src);
    endtask

    initial begin
        jump = 0;

        // ---- beq (funct3=000) ----
        funct3 = 3'b000; branch = 1;
        alu_result = 32'b0;  #1; check(1, 0); // equal -> take
        alu_result = 32'd5;  #1; check(0, 0); // not equal -> no take

        // ---- bne (funct3=001) ----
        funct3 = 3'b001; branch = 1;
        alu_result = 32'd5;  #1; check(1, 0); // not equal -> take
        alu_result = 32'b0;  #1; check(0, 0); // equal -> no take

        // ---- blt (funct3=100) ----
        funct3 = 3'b100; branch = 1;
        alu_result = 32'd1;  #1; check(1, 0); // rs1 < rs2 -> take
        alu_result = 32'b0;  #1; check(0, 0); // rs1 >= rs2 -> no take

        // ---- bge (funct3=101) ----
        funct3 = 3'b101; branch = 1;
        alu_result = 32'b0;  #1; check(1, 0); // rs1 >= rs2 -> take
        alu_result = 32'd1;  #1; check(0, 0); // rs1 < rs2 -> no take

        // ---- bltu (funct3=110) ----
        funct3 = 3'b110; branch = 1;
        alu_result = 32'd1;  #1; check(1, 0); // rs1 < rs2 unsigned -> take
        alu_result = 32'b0;  #1; check(0, 0); // rs1 >= rs2 unsigned -> no take

        // ---- bgeu (funct3=111) ----
        funct3 = 3'b111; branch = 1;
        alu_result = 32'b0;  #1; check(1, 0); // rs1 >= rs2 unsigned -> take
        alu_result = 32'd1;  #1; check(0, 0); // rs1 < rs2 unsigned -> no take

        // ---- branch=0, should never take ----
        funct3 = 3'b000; branch = 0;
        alu_result = 32'b0;  #1; check(0, 0); // beq condition true but branch=0

        // ---- jump=1, always take ----
        jump = 1; branch = 0; funct3 = 3'b000; alu_result = 32'd99;
        #1; check(1, 0);

        $finish;
    end

endmodule
