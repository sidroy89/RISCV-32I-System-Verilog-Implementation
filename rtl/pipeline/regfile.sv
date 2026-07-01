module regfile(
    input logic clk,
    input logic [4:0] rs1_addr,
    input logic [4:0] rs2_addr,
    input logic [4:0] rd_addr,
    input logic [31:0] rd_data,
    input logic reg_write_en,
    output logic [31:0] rs1_data,
    output logic [31:0] rs2_data
);

    logic [31:0] regfile [31:0];  // 32 registers, each 32 bits wide

    // Read ports (combinational) with internal forwarding (WB -> ID same cycle)
    assign rs1_data = (reg_write_en && rd_addr == rs1_addr && rs1_addr != 5'b0)
                      ? rd_data
                      : (rs1_addr != 5'b0 ? regfile[rs1_addr] : 32'b0);

    assign rs2_data = (reg_write_en && rd_addr == rs2_addr && rs2_addr != 5'b0)
                      ? rd_data
                      : (rs2_addr != 5'b0 ? regfile[rs2_addr] : 32'b0);

    // Write port (synchronous)
    always_ff @(posedge clk) begin
        if (reg_write_en && rd_addr != 5'b0) begin
            regfile[rd_addr] <= rd_data;  // Write to register file, but never write to x0
        end
    end
endmodule