module imem(
    input logic [31:0] pc, // program counter input
    output logic [31:0] instr // instruction output
);

logic [31:0] memory [0:16383]; // each entry is an instruction which is 32 bits wide, and we have 64KB

initial begin
    $readmemh("tests/program.hex", memory);
end

assign instr = memory[(pc - 32'h80000000) >> 2];

endmodule