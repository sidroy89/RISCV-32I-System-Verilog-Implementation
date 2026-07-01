module dmem #(parameter MEM_SIZE = 65536) (
    input  logic        clk,
    input  logic [31:0] addr, // read or write address
    input  logic [31:0] wr_data,   // data to be written to memory
    input  logic        we, // write enable
    input  logic        re, // read enable
    input logic [2:0]  funct3, // to determine the type of load/store (byte, halfword, word)
    output logic [31:0] rd_data
);

    logic [7:0] memory [0:MEM_SIZE-1]; // byte addressable

    initial begin
        $readmemh("tests/dmem.hex", memory);
    end

    wire [31:0] offset = addr - 32'h80000000;

    // combinational read: assemble 4 bytes into a 32-bit word (little-endian)
    always @(*) begin
        if (re) begin
            case (funct3)
                3'b000: rd_data= {{24{memory[offset][7]}}, memory[offset]}; // LB
                3'b001: rd_data= {{16{memory[offset+1][7]}}, memory[offset+1], memory[offset]}; // LH, little-endian
                3'b010: rd_data= {memory[offset+3], memory[offset+2], memory[offset+1], memory[offset]}; // LW, little-endian
                3'b100: rd_data= {24'b0, memory[offset]}; // LBU
                3'b101: rd_data= {16'b0, memory[offset+1], memory[offset]}; // LHU
                default: rd_data = 32'b0;

            endcase
        end
        else begin
            rd_data = 32'b0;
        end
    end

    // synchronous write: split 32-bit word into 4 bytes
    always_ff @(posedge clk) begin
        if (we) begin
            case(funct3)
                3'b000: memory[offset] <= wr_data[7:0]; // SB
                3'b001: begin // SH
                    memory[offset] <= wr_data[7:0];
                    memory[offset+1] <= wr_data[15:8];
                end
                3'b010: begin // SW
                    memory[offset] <= wr_data[7:0];
                    memory[offset+1] <= wr_data[15:8];
                    memory[offset+2] <= wr_data[23:16];
                    memory[offset+3] <= wr_data[31:24];
                end
                default: ; // do nothing for unsupported funct3 values
                
            endcase
        end
        else begin
            // do nothing if write enable is not asserted
        end
    end

endmodule
