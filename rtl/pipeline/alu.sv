module alu (
    input  logic [3:0]  alu_ctrl,
    input  logic [31:0] a,
    input  logic [31:0] b,
    output logic [31:0] result,
    output logic        zero
);

always_comb begin
    case (alu_ctrl)
        4'b0000: result = a + b;   // ADD
        4'b0001: result = a - b;   // SUB
        4'b0010: result = a & b;   // AND
        4'b0011: result = a | b;   // OR
        4'b0100: result = a ^ b;   // XOR
        4'b0101: result = a << b[4:0];  // Logical SHifth Left
        4'b0110: result = a >> b[4:0];  // Logical Shift Right
        4'b0111: result = $signed(a) >>> b[4:0];  // Arithmetic Shift Right
        4'b1000: result = ($signed(a) < $signed(b)) ? 32'b1 : 32'b0;  // SLT
        4'b1001: result = (a < b) ? 32'b1 : 32'b0;  // SLTU
        4'b1010: result=b;// just passes arg 2 through
        default: result = 32'b0;

        
    endcase

    zero = (result == 32'b0);
end

endmodule