module tb_dmem;

    logic        clk;
    logic [31:0] addr;
    logic [31:0] wr_data;
    logic        we, re;
    logic [2:0]  funct3;
    logic [31:0] rd_data;

    dmem #(.MEM_SIZE(1024)) dut (
        .clk     (clk),
        .addr    (addr),
        .wr_data (wr_data),
        .we      (we),
        .re      (re),
        .funct3  (funct3),
        .rd_data (rd_data)
    );

    initial clk = 0;
    always #5 clk = ~clk;

    initial begin
        we = 0; re = 0; addr = 0; wr_data = 0; funct3 = 0;

        // ---- SW then LW ----
        addr = 32'h00C; wr_data = 32'hDEADBEEF; funct3 = 3'b010; we = 1;
        @(posedge clk); #1;
        we = 0; re = 1;
        #1;
        if (rd_data === 32'hDEADBEEF)
            $display("PASS SW/LW: got %h", rd_data);
        else
            $display("FAIL SW/LW: got %h (exp DEADBEEF)", rd_data);

        // ---- SB then LB (signed) ----
        // write 0xFF to addr 0x200 -> should sign-extend to 0xFFFFFFFF (-1)
        addr = 32'h020; wr_data = 32'hFF; funct3 = 3'b000; we = 1; re = 0;
        @(posedge clk); #1;
        we = 0; re = 1;
        #1;
        if (rd_data === 32'hFFFFFFFF)
            $display("PASS SB/LB signed: got %h", rd_data);
        else
            $display("FAIL SB/LB signed: got %h (exp FFFFFFFF)", rd_data);

        // ---- LBU (unsigned) same address ----
        funct3 = 3'b100;
        #1;
        if (rd_data === 32'h000000FF)
            $display("PASS LBU: got %h", rd_data);
        else
            $display("FAIL LBU: got %h (exp 000000FF)", rd_data);

        // ---- SH then LH (signed) ----
        // write 0xFF80 to addr 0x300 -> sign-extended = 0xFFFFFF80
        addr = 32'h040; wr_data = 32'hFF80; funct3 = 3'b001; we = 1; re = 0;
        @(posedge clk); #1;
        we = 0; re = 1;
        #1;
        if (rd_data === 32'hFFFFFF80)
            $display("PASS SH/LH signed: got %h", rd_data);
        else
            $display("FAIL SH/LH signed: got %h (exp FFFFFF80)", rd_data);

        // ---- LHU (unsigned) same address ----
        funct3 = 3'b101;
        #1;
        if (rd_data === 32'h0000FF80)
            $display("PASS LHU: got %h", rd_data);
        else
            $display("FAIL LHU: got %h (exp 0000FF80)", rd_data);

        // ---- re=0 should output 0 ----
        re = 0; addr = 32'h00C;
        #1;
        if (rd_data === 32'b0)
            $display("PASS re=0: output is 0");
        else
            $display("FAIL re=0: got %h (exp 0)", rd_data);

        $finish;
    end

endmodule
