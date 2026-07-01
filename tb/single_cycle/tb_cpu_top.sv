module tb_cpu_top;

    logic clk;
    logic rst;

    cpu_top dut (
        .clk (clk),
        .rst (rst)
    );

    // clock: 10 time unit period
    initial clk = 0;
    always #5 clk = ~clk;

    // peek inside datapath to monitor instruction and registers
    wire [31:0] pc    = dut.dp_inst.pc;
    wire [31:0] instr = dut.dp_inst.instr;
    wire [31:0] a0    = dut.dp_inst.rf_inst.regfile[10]; // x10 = a0

    initial begin
        rst = 1;
        @(posedge clk);
        @(posedge clk);
        rst = 0;

        // run until ecall (instr == 32'h00000073) or timeout
        repeat (10000) begin
            @(posedge clk);
            if (instr == 32'h00000073) begin
                if (a0 == 32'b0)
                    $display("PASS: test completed successfully");
                else
                    $display("FAIL: test failed with code %0d", a0 >> 1);
                $finish;
            end
        end

        $display("TIMEOUT: ecall not reached in 10000 cycles");
        $finish;
    end

endmodule
