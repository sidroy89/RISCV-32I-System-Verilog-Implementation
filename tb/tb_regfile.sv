module tb_regfile;

    logic        clk;
    logic [4:0]  rs1_addr, rs2_addr, rd_addr;
    logic [31:0] rd_data;
    logic        reg_write_en;
    logic [31:0] rs1_data, rs2_data;

    regfile dut (
        .clk          (clk),
        .rs1_addr     (rs1_addr),
        .rs2_addr     (rs2_addr),
        .rd_addr      (rd_addr),
        .rd_data      (rd_data),
        .reg_write_en (reg_write_en),
        .rs1_data     (rs1_data),
        .rs2_data     (rs2_data)
    );

    // generate clock: toggles every 5 time units -> period = 10
    initial clk = 0;
    always #5 clk = ~clk;

    initial begin
        reg_write_en = 0;
        rd_addr = 0; rd_data = 0;
        rs1_addr = 0; rs2_addr = 0;

        // Test 1: x0 always reads as 0
        rs1_addr = 5'd0;
        #1;
        if (rs1_data === 32'b0)
            $display("PASS: x0 reads as 0");
        else
            $display("FAIL: x0 should be 0, got %0d", rs1_data);

        // Test 2: write to x1, read back
        rd_addr = 5'd1; rd_data = 32'hDEADBEEF; reg_write_en = 1;
        @(posedge clk); #1;  // wait for clock edge, then let signals settle
        reg_write_en = 0;
        rs1_addr = 5'd1;
        #1;
        if (rs1_data === 32'hDEADBEEF)
            $display("PASS: x1 reads back 0xDEADBEEF");
        else
            $display("FAIL: x1 got %h", rs1_data);

        // Test 3: write to x2, read both x1 and x2 simultaneously
        rd_addr = 5'd2; rd_data = 32'hCAFEBABE; reg_write_en = 1;
        @(posedge clk); #1;
        reg_write_en = 0;
        rs1_addr = 5'd1; rs2_addr = 5'd2;
        #1;
        if (rs1_data === 32'hDEADBEEF && rs2_data === 32'hCAFEBABE)
            $display("PASS: simultaneous read x1=%h x2=%h", rs1_data, rs2_data);
        else
            $display("FAIL: x1=%h x2=%h", rs1_data, rs2_data);

        // Test 4: write to x0 should be ignored
        rd_addr = 5'd0; rd_data = 32'hFFFFFFFF; reg_write_en = 1;
        @(posedge clk); #1;
        reg_write_en = 0;
        rs1_addr = 5'd0;
        #1;
        if (rs1_data === 32'b0)
            $display("PASS: write to x0 ignored, still reads 0");
        else
            $display("FAIL: x0 was written, got %h", rs1_data);

        // Test 5: write enable low, value should not change
        rs1_addr = 5'd1;
        rd_addr = 5'd1; rd_data = 32'h0; reg_write_en = 0;
        @(posedge clk); #1;
        if (rs1_data === 32'hDEADBEEF)
            $display("PASS: write disabled, x1 unchanged");
        else
            $display("FAIL: x1 changed without write enable, got %h", rs1_data);

        $finish;
    end

endmodule
