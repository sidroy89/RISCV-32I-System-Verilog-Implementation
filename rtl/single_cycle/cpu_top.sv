module cpu_top (
    input logic clk,
    input logic rst
);

    datapath dp_inst (
        .clk (clk),
        .rst (rst)
    );

endmodule
