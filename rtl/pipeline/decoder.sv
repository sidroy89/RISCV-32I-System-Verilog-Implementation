module decoder (
    input  logic [6:0] opcode,
    input  logic [2:0] funct3,
    input  logic [6:0] funct7,

    output logic [1:0] writeback_mux,  // 00=PC+4, 01=ALU result, 10=memory data
    output logic       reg_write_en,   // 1 if instruction writes to a register
    output logic       PC_or_Rs1_mux,  // 0=use PC, 1=use Rs1 (for JALR)
    output logic       alu_src_mux_1,  // 0=use Rs1, 1=use PC (for AUIPC)
    output logic       alu_src_mux_2,  // 0=use Rs2, 1=use immediate
    output logic [3:0] alu_op,         // ALU operation select
    output logic       branch,         // 1 if conditional branch
    output logic       jump,           // 1 if jal or jalr
    output logic       dmem_wr_en,     // 1 if store instruction
    output logic       dmem_rd_en      // 1 if load instruction
);

    always_comb begin
        // defaults
        writeback_mux = 2'b00;
        reg_write_en  = 1'b0;
        PC_or_Rs1_mux = 1'b0;
        alu_src_mux_1 = 1'b0;
        alu_src_mux_2 = 1'b0;
        alu_op        = 4'b0000;
        branch        = 1'b0;
        jump          = 1'b0;
        dmem_wr_en    = 1'b0;
        dmem_rd_en    = 1'b0;

        case (opcode)

            // R-type
            7'b0110011: begin
                reg_write_en  = 1'b1;
                alu_src_mux_2 = 1'b0;  // use Rs2
                writeback_mux = 2'b01; // ALU result
                case ({funct3, funct7})
                    10'b0000000000: alu_op = 4'b0000; // ADD
                    10'b0000100000: alu_op = 4'b0001; // SUB
                    10'b1110000000: alu_op = 4'b0010; // AND
                    10'b1100000000: alu_op = 4'b0011; // OR
                    10'b1000000000: alu_op = 4'b0100; // XOR
                    10'b0010000000: alu_op = 4'b0101; // SLL
                    10'b1010000000: alu_op = 4'b0110; // SRL
                    10'b1010100000: alu_op = 4'b0111; // SRA
                    10'b0100000000: alu_op = 4'b1000; // SLT
                    10'b0110000000: alu_op = 4'b1001; // SLTU
                    default:        alu_op = 4'b0000;
                endcase
            end

            // I-type arithmetic
            7'b0010011: begin
                reg_write_en  = 1'b1;
                alu_src_mux_2 = 1'b1;  // use immediate
                writeback_mux = 2'b01; // ALU result
                case (funct3)
                    3'b000: alu_op = 4'b0000; // ADDI
                    3'b111: alu_op = 4'b0010; // ANDI
                    3'b110: alu_op = 4'b0011; // ORI
                    3'b100: alu_op = 4'b0100; // XORI
                    3'b010: alu_op = 4'b1000; // SLTI
                    3'b011: alu_op = 4'b1001; // SLTIU
                    3'b001: alu_op = 4'b0101; // SLLI
                    3'b101: begin
                        if (funct7 == 7'b0100000)
                            alu_op = 4'b0111; // SRAI
                        else
                            alu_op = 4'b0110; // SRLI
                    end
                    default: alu_op = 4'b0000;
                endcase
            end

            // Loads
            7'b0000011: begin
                reg_write_en  = 1'b1;
                alu_src_mux_2 = 1'b1;  // use immediate for address
                dmem_rd_en    = 1'b1;
                writeback_mux = 2'b10; // memory data
                alu_op        = 4'b0000; // ADD for address calc
            end

            // TODO: stores, branches, jal, jalr, lui, auipc


            // STORES
            7'b0100011:begin
                reg_write_en  = 1'b0;
                alu_src_mux_2 = 1'b1;  // use immediate for address
                dmem_wr_en    = 1'b1;
                alu_op        = 4'b0000; // ADD for address calc
            end


            // Branches
            7'b1100011:begin
                reg_write_en= 1'b0; 
                PC_or_Rs1_mux = 1'b0;  // pc so we can do pc + imm for branch target
                branch = 1'b1;
                jump = 1'b0;
                alu_src_mux_2 = 1'b0;  // use Rs2 for comparison
                alu_src_mux_1 = 1'b0;  // use PC for branch target calculation
                case (funct3)
                    3'b000: alu_op = 4'b0001; // beq  - SUB
                    3'b001: alu_op = 4'b0001; // bne  - SUB
                    3'b100: alu_op = 4'b1000; // blt  - SLT
                    3'b101: alu_op = 4'b1000; // bge  - SLT
                    3'b110: alu_op = 4'b1001; // bltu - SLTU
                    3'b111: alu_op = 4'b1001; // bgeu - SLTU
                    default: alu_op = 4'b0001;
                endcase
            end

            // JAL
            7'b1101111:begin
                writeback_mux = 2'b00; // PC+4
                reg_write_en  = 1'b1;
                PC_or_Rs1_mux = 1'b0;  // use PC for jump
                jump          = 1'b1;
            end

            // JALR
            7'b1100111: begin
                writeback_mux = 2'b00; // PC+4
                reg_write_en  = 1'b1;
                PC_or_Rs1_mux = 1'b1;  // use Rs1 for jump target
                jump          = 1'b1;
                alu_src_mux_2 = 1'b1;  // use imm so ALU computes rs1+imm (JALR target)
                alu_op        = 4'b0000; // ADD
            end

            //LUI oads a 20-bit immediate into the upper 20 bits of rd, with the lower 12 bits set to zero.
            7'b0110111:begin
                reg_write_en  = 1'b1;
                alu_src_mux_2=1'b1;  // use immediate
                alu_op=4'b1010; // pass imm through
                writeback_mux=2'b01; // ALU result
            end
            // AUIPC: rd = PC + imm
            7'b0010111: begin
                reg_write_en  = 1'b1;
                alu_src_mux_1 = 1'b1;  // use PC as ALU input A
                alu_src_mux_2 = 1'b1;  // use immediate
                alu_op        = 4'b0000; // ADD
                writeback_mux = 2'b01;  // ALU result
            end

            // SYSTEM (ecall, ebreak) - do nothing
            7'b1110011: ;

            default: ;

        endcase
    end

endmodule
