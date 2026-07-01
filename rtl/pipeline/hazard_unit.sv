// hazard_unit.sv
// Detects load-use hazards and generates stall signals.
// Stall condition: ID/EX.mem_read == 1 AND (ID/EX.rd_addr == IF/ID.rs1_addr OR ID/EX.rd_addr == IF/ID.rs2_addr)
// On stall: PC freeze, IF/ID freeze, ID/EX bubble inserted.

module hazard_unit (
    // From ID/EX (instruction currently in EX)
    input  logic [4:0] idex_rd_addr,
    input  logic       idex_mem_read,

    // From field_extractor output in ID stage (instruction currently in ID)
    input  logic [4:0] rs1_addr,
    input  logic [4:0] rs2_addr,

    // Stall output
    output logic stall
);

    assign stall = idex_mem_read &&
                   (idex_rd_addr == rs1_addr || idex_rd_addr == rs2_addr);

endmodule
