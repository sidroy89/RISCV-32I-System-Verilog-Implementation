// forwarding_unit.sv
// Detects RAW hazards and generates forwarding mux select signals for EX stage ALU inputs.
// Forwarding paths:
//   No forward needed   (forward_a/b = 2'b00, use value from ID/EX register file read)
//   Path 1: EX/MEM -> EX (forward_a/b = 2'b01)
//   Path 2: MEM/WB -> EX (forward_a/b = 2'b10)

module forwarding_unit (
    // From ID/EX (current instruction in EX)
    input  logic [4:0] rs1_addr,
    input  logic [4:0] rs2_addr,

    // From EX/MEM (instruction 1 ahead)
    input  logic [4:0] exmem_rd_addr,
    input  logic       exmem_reg_write_en,

    // From MEM/WB (instruction 2 ahead)
    input  logic [4:0] memwb_rd_addr,
    input  logic       memwb_reg_write_en,

    // Forwarding mux select signals
    output logic [1:0] forward_a,   // for rs1: 00=no fwd, 01=EX/MEM, 10=MEM/WB
    output logic [1:0] forward_b    // for rs2: 00=no fwd, 01=EX/MEM, 10=MEM/WB
);

    always_comb begin
        // Default: no forwarding
        forward_a = 2'b00;
        forward_b = 2'b00;

        // EX/MEM forwarding takes priority (most recent value)
        if (exmem_reg_write_en && exmem_rd_addr != 5'b0 && exmem_rd_addr == rs1_addr)
            forward_a = 2'b01;
        else if (memwb_reg_write_en && memwb_rd_addr != 5'b0 && memwb_rd_addr == rs1_addr)
            forward_a = 2'b10;

        if (exmem_reg_write_en && exmem_rd_addr != 5'b0 && exmem_rd_addr == rs2_addr)
            forward_b = 2'b01;
        else if (memwb_reg_write_en && memwb_rd_addr != 5'b0 && memwb_rd_addr == rs2_addr)
            forward_b = 2'b10;
    end

endmodule
