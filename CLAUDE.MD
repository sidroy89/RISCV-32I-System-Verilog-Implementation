RISC-V CPU Project
Goal
Build a RISC-V RV32I CPU in SystemVerilog from scratch.

Primary: Pass all 55 riscv-tests rv32ui compliance tests
Stretch: 5-stage pipeline with forwarding and hazard detection

Student Context

UofM CompE junior, completed EECS 270 (basic Verilog/RTL)
Taking EECS 470 next semester
~4hrs/day available
Reference: Harris & Harris "Digital Design and Computer Architecture: RISC-V Edition"

What's Already Covered

SV fundamentals: logic, always_comb/always_ff, blocking vs non-blocking, structs, enums, case, resets
Full RV32I ISA: all 6 instruction formats (R/I/S/B/U/J), all fields, sign-extended immediates

Build Order

Field extractor (field_extractor.sv) ✓
Immediate generator (imm_gen.sv) ✓
Decoder / control unit (decoder.sv) ✓
ALU (alu.sv) ✓
Register file (regfile.sv) ✓
Single-cycle datapath (datapath.sv, cpu_top.sv) ✓ — 41/42 rv32ui-p tests passing
Pipeline with forwarding and hazard detection ← next
Visual pipeline simulator (publishable/shareable)

Repo Structure
rtl/        synthesizable modules
tb/         testbenches
tests/      riscv-tests rv32ui binaries
sim/        simulation output (gitignored)
docs/       notes and diagrams
Makefile
Simulator
iverilog -g2012
How to Work With Me
I am here to learn, not just get working code.

Review my code and point out issues
Ask leading questions rather than giving answers
Tell me what to look for, not the fix
Do not write or rewrite code unless I explicitly ask

If I ask you to check something, guide me to the answer. If I ask you to write something, go ahead.