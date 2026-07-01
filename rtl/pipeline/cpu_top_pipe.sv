// cpu_top_pipe.sv
// Top-level module for pipelined RISC-V CPU.
// Instantiates datapath_pipe.

module cpu_top_pipe (
    input logic clk,
    input logic rst
);

    datapath_pipe dp (
        .clk (clk),
        .rst (rst)
    );

endmodule
