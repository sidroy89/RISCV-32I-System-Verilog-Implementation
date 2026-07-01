#!/bin/bash
# Run all rv32ui-p compliance tests
# Usage: ./scripts/run_tests.sh [sc|pipe]  (default: sc)

MODE=${1:-sc}
TESTS_DIR="tests/riscv-tests/isa"
SIM_DIR="sim"
PASS=0
FAIL=0
ERRORS=()

mkdir -p $SIM_DIR

if [ "$MODE" = "pipe" ]; then
    echo "=== Pipeline CPU ==="
    iverilog -g2012 -o $SIM_DIR/tb_cpu_top_pipe \
        rtl/pipeline/cpu_top_pipe.sv \
        rtl/pipeline/datapath_pipe.sv \
        rtl/pipeline/decoder.sv \
        rtl/pipeline/alu.sv \
        rtl/pipeline/regfile.sv \
        rtl/pipeline/imem.sv \
        rtl/pipeline/dmem.sv \
        rtl/pipeline/field_extractor.sv \
        rtl/pipeline/imm_gen.sv \
        rtl/pipeline/branch_logic.sv \
        rtl/pipeline/forwarding_unit.sv \
        rtl/pipeline/hazard_unit.sv \
        tb/pipeline/tb_cpu_top_pipe.sv 2>/dev/null
    SIM_BIN=$SIM_DIR/tb_cpu_top_pipe
else
    echo "=== Single Cycle CPU ==="
    iverilog -g2012 -o $SIM_DIR/tb_cpu_top \
        rtl/single_cycle/cpu_top.sv \
        rtl/single_cycle/datapath.sv \
        rtl/single_cycle/decoder.sv \
        rtl/single_cycle/alu.sv \
        rtl/single_cycle/regfile.sv \
        rtl/single_cycle/imem.sv \
        rtl/single_cycle/dmem.sv \
        rtl/single_cycle/field_extractor.sv \
        rtl/single_cycle/imm_gen.sv \
        rtl/single_cycle/branch_logic.sv \
        tb/single_cycle/tb_cpu_top.sv 2>/dev/null
    SIM_BIN=$SIM_DIR/tb_cpu_top
fi

if [ $? -ne 0 ]; then
    echo "Compilation failed"
    exit 1
fi

for test in $TESTS_DIR/rv32ui-p-*; do
    [[ $test == *.dump ]] && continue

    name=$(basename $test)

    # convert to hex
    riscv64-elf-objcopy -O verilog $test /tmp/test.hex
    python3 scripts/hex_convert.py /tmp/test.hex tests/program.hex tests/dmem.hex

    # run simulation
    result=$(vvp $SIM_BIN 2>/dev/null | grep -E "PASS|FAIL|TIMEOUT")

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
