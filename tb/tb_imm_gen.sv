module tb_imm_gen;

    logic [31:0] instr;
    logic [31:0] imm;

    imm_gen dut (
        .instr (instr),
        .imm   (imm)
    );

    initial begin
        // ---- I-type (OP-IMM opcode) ----
        // imm[11:0] = instr[31:20], sign-extended
        // imm = 12'b000000000101 = 5
        instr = {12'b000000000101, 5'b00001, 3'b000, 5'b00001, 7'b0010011};
        #1;
        $display("I-type imm=5:    got %0d (exp 5)",    $signed(imm));

        // imm = 12'b111111111111 = -1
        instr = {12'b111111111111, 5'b00001, 3'b000, 5'b00001, 7'b0010011};
        #1;
        $display("I-type imm=-1:   got %0d (exp -1)",   $signed(imm));

        // ---- S-type ----
        // imm[11:5] = instr[31:25], imm[4:0] = instr[11:7]
        // imm = 8 = 12'b000000001000, so [11:5]=0000000 [4:0]=01000
        instr = {7'b0000000, 5'b00010, 5'b00001, 3'b010, 5'b01000, 7'b0100011};
        #1;
        $display("S-type imm=8:    got %0d (exp 8)",    $signed(imm));

        // ---- B-type ----
        // imm = 16 = 13'b0000000010000
        // imm[12]=0 imm[11]=0 imm[10:5]=000000 imm[4:1]=1000 imm[0]=0
        // instr[31]=0 instr[7]=0 instr[30:25]=000000 instr[11:8]=1000
        instr = {1'b0, 6'b000000, 5'b00010, 5'b00001, 3'b000, 4'b1000, 1'b0, 7'b1100011};
        #1;
        $display("B-type imm=16:   got %0d (exp 16)",   $signed(imm));

        // ---- U-type (lui) ----
        // imm = upper 20 bits set to 1, lower 12 = 0
        instr = {20'b00000000000000000001, 5'b00001, 7'b0110111};
        #1;
        $display("U-type imm=4096: got %0d (exp 4096)", $signed(imm));

        // ---- J-type ----
        // imm = 20 = 21'b000000000000000010100
        // imm[20]=0 imm[19:12]=00000000 imm[11]=0 imm[10:1]=0000010100 imm[0]=0
        // instr[31]=0 instr[19:12]=00000000 instr[20]=0 instr[30:21]=0000010100
        instr = {1'b0, 10'b0000010100, 1'b0, 8'b00000000, 5'b00000, 7'b1101111};
        #1;
        $display("J-type imm=40:   got %0d (exp 40)",   $signed(imm));

        $finish;
    end

endmodule
