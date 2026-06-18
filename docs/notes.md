# RiscV SC Impl - Project Notes

## Where We Are
All RTL modules are written and the CPU is running. The first compliance test (rv32ui-p-add) passes.
We are now in the **test-running phase** — running all 55 rv32ui-p compliance tests to find bugs.

---

## What Was Built (in order)
1. `field_extractor.sv` — slices fixed fields (opcode, rd, rs1, rs2, funct3, funct7) from instruction
2. `imm_gen.sv` — reconstructs and sign-extends immediates for I/S/B/U/J formats
3. `alu.sv` — 10 operations: ADD, SUB, AND, OR, XOR, SLL, SRL, SRA, SLT, SLTU + PASS_B for LUI
4. `regfile.sv` — 32 x 32-bit registers, combinational reads, synchronous writes, x0 hardwired to 0
5. `imem.sv` — instruction memory (word-addressed, 16KB), loaded via $readmemh
6. `dmem.sv` — data memory (byte-addressable, little-endian), supports lb/lh/lw/lbu/lhu/sb/sh/sw
7. `branch_logic.sv` — determines if branch/jump is taken based on ALU result and funct3
8. `decoder.sv` — maps opcode/funct3/funct7 to 10 control signals
9. `datapath.sv` — wires all modules together, contains PC register and muxes
10. `cpu_top.sv` — top-level, instantiates datapath

---

## Setting Up riscv-tests (what happened and why)

### Step 1: Install RISC-V toolchain
We needed `riscv64-elf-objcopy` to convert compiled test binaries to hex format.
```
brew install riscv64-elf-gcc
```
This installed pre-compiled binaries — much faster than `riscv-tools` which builds from source.

### Step 2: Clone riscv-tests
```
git clone https://github.com/riscv-software-src/riscv-tests tests/riscv-tests
```
This gives us the test source files (.S assembly files) and build system.

### Step 3: Initialize submodules
The repo has a submodule (env/ — the test environment headers).
Without this, compilation fails with "riscv_test.h not found":
```
cd tests/riscv-tests && git submodule update --init --recursive
```

### Step 4: Compile the tests
```
cd tests/riscv-tests && make isa RISCV_PREFIX=riscv64-elf-
```
- `RISCV_PREFIX=riscv64-elf-` tells the build system to use our installed toolchain
- The `v` (virtual memory) tests failed — they need a C stdlib we don't have
- But the `p` (physical memory, bare-metal) tests compiled fine — those are what we need
- Output: `tests/riscv-tests/isa/rv32ui-p-add`, `rv32ui-p-addi`, etc.

### Step 5: Convert binaries to hex
The riscv-tests binaries are ELF files — not directly usable by `$readmemh`.
`objcopy -O verilog` converts them to a byte-by-byte hex format:
```
riscv64-elf-objcopy -O verilog rv32ui-p-add /tmp/test.hex
```
But this produces:
```
@80000000
6F 00 00 05 73 2F ...  (bytes, not words)
```
Problems:
1. `@80000000` — the test loads at address 0x80000000, not 0x0
2. Bytes not words — our imem uses 32-bit words

So we wrote `scripts/hex_convert.py` to strip the address annotation and reassemble bytes into little-endian 32-bit words, one per line.

### Step 6: Fix the CPU for the 0x80000000 load address
Two changes needed:
1. PC resets to `0x80000000` instead of `0x0` (in datapath.sv)
2. imem subtracts the base: `memory[(pc - 32'h80000000) >> 2]`

---

## How Pass/Fail Detection Works
The riscv-tests use `ecall` (instruction `0x00000073`) to signal completion.
- Before ecall, they set register `a0` (x10) to 0 if PASS, nonzero if FAIL
- Our testbench monitors the instruction bus and checks x10 when ecall is seen
- The fail code is `a0 >> 1` — which test case failed

---

## Control Signals (decoder outputs)
| Signal | Purpose |
|--------|---------|
| `reg_write_en` | write to register file |
| `alu_src_mux_1` | ALU input A: 0=rs1, 1=PC (auipc) |
| `alu_src_mux_2` | ALU input B: 0=rs2, 1=imm |
| `alu_op [3:0]` | ALU operation |
| `mem_we` | dmem write enable |
| `mem_re` | dmem read enable |
| `writeback_mux [1:0]` | 00=PC+4, 01=ALU result, 10=mem data |
| `branch` | conditional branch instruction |
| `jump` | jal or jalr |
| `PC_or_Rs1_mux` | adder input: 0=PC, 1=rs1 (jalr) |

---

## Run All Tests
```
bash scripts/run_tests.sh
```
