#!/bin/bash
# Run all rv32ui-p compliance tests

TESTS_DIR="tests/riscv-tests/isa"
SIM_DIR="sim"
PASS=0
FAIL=0
ERRORS=()

# compile the CPU once
iverilog -g2012 -o $SIM_DIR/tb_cpu_top \
    rtl/cpu_top.sv rtl/datapath.sv rtl/decoder.sv rtl/alu.sv \
    rtl/regfile.sv rtl/imem.sv rtl/dmem.sv rtl/field_extractor.sv \
    rtl/imm_gen.sv rtl/branch_logic.sv tb/tb_cpu_top.sv 2>/dev/null

if [ $? -ne 0 ]; then
    echo "Compilation failed"
    exit 1
fi

for test in $TESTS_DIR/rv32ui-p-*; do
    # skip .dump files
    [[ $test == *.dump ]] && continue

    name=$(basename $test)

    # convert to hex
    riscv64-elf-objcopy -O verilog $test /tmp/test.hex
    python3 scripts/hex_convert.py /tmp/test.hex tests/program.hex tests/dmem.hex

    # run simulation
    result=$(vvp $SIM_DIR/tb_cpu_top 2>/dev/null | grep -E "PASS|FAIL|TIMEOUT")

    if [[ $result == *"PASS"* ]]; then
        echo "PASS: $name"
        ((PASS++))
    else
        echo "FAIL: $name -- $result"
        ((FAIL++))
        ERRORS+=($name)
    fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed out of $((PASS+FAIL)) tests"
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo "Failed tests: ${ERRORS[*]}"
fi
