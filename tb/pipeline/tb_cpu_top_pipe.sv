// tb_cpu_top_pipe.sv
// Testbench for pipelined RISC-V CPU.
// Same pass/fail detection as single-cycle: monitor for ecall (0x00000073), check x10 == 0.

module tb_cpu_top_pipe;

    logic clk, rst;

    cpu_top_pipe dut (
        .clk (clk),
        .rst (rst)
    );

    // 10 time unit clock
    initial clk = 0;
    always #5 clk = ~clk;

    // peek inside pipeline datapath
    wire [31:0] pc          = dut.dp.pc;
    wire [31:0] instr       = dut.dp.ifid_instr;
    wire [31:0] a0          = dut.dp.rf_inst.regfile[10];
    wire [31:0] idex_instr  = dut.dp.idex_rd_addr;  // rd_addr in EX for context
    wire        stall       = dut.dp.stall;
    wire        pc_src      = dut.dp.branch_logic_pc_src;

    integer cycle = 0;

    // print every cycle for first 20 cycles to check startup
    always @(posedge clk) begin
        cycle <= cycle + 1;
        if (cycle < 20)
            $display("cycle=%0d pc=%08h instr=%08h a0=%08h stall=%b pc_src=%b",
                     cycle, pc, instr, a0, stall, pc_src);
    end

    initial begin
        rst = 1;
        @(posedge clk);
        @(posedge clk);
        rst = 0;

        // run until ecall (0x00000073) or timeout
        repeat (50000) begin
            @(posedge clk);
            if (instr == 32'h00000073) begin
                // ecall is in ID — wait 3 more cycles for prior instructions to drain through WB
                repeat(3) @(posedge clk);
                $display("--- ecall detected at cycle %0d ---", cycle);
                $display("pc=%08h a0=%08h", pc, a0);
                if (a0 == 32'b0)
                    $display("PASS: test completed successfully");
                else
                    $display("FAIL: test failed with code %0d", a0 >> 1);
                $finish;
            end
        end

        $display("TIMEOUT: ecall not reached in 50000 cycles");
        $finish;
    end

endmodule
