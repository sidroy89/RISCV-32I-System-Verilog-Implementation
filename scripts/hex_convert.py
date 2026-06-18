#!/usr/bin/env python3
# Converts objcopy -O verilog hex output to:
#   output_imem: word-per-line hex for imem $readmemh (32-bit array)
#   output_dmem: byte-per-line hex with @address markers for dmem $readmemh (8-bit array)
# Usage: python3 scripts/hex_convert.py input.hex output_imem output_dmem

import sys

BASE_ADDR = 0x80000000

def convert(input_file, imem_file, dmem_file):
    # Parse objcopy verilog format: track address, collect (addr, byte) pairs
    segments = []  # list of (start_addr, [bytes])
    current_addr = 0
    current_bytes = []

    with open(input_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('@'):
                if current_bytes:
                    segments.append((current_addr, current_bytes))
                current_addr = int(line[1:], 16)
                current_bytes = []
            else:
                for byte in line.split():
                    current_bytes.append(int(byte, 16))
    if current_bytes:
        segments.append((current_addr, current_bytes))

    # Build flat byte map: offset -> byte (offset from BASE_ADDR)
    byte_map = {}
    for addr, data in segments:
        for i, b in enumerate(data):
            byte_map[addr - BASE_ADDR + i] = b

    if not byte_map:
        return

    # --- imem: word-per-line, sequential from offset 0 ---
    max_offset = max(byte_map.keys())
    total_bytes = max_offset + 1
    while total_bytes % 4 != 0:
        total_bytes += 1

    with open(imem_file, 'w') as f:
        for i in range(0, total_bytes, 4):
            b = [byte_map.get(i+j, 0) for j in range(4)]
            word = (b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]
            f.write(f'{word:08X}\n')

    # --- dmem: byte-per-line with @address markers per segment ---
    with open(dmem_file, 'w') as f:
        for addr, data in segments:
            offset = addr - BASE_ADDR
            f.write(f'@{offset:08X}\n')
            for b in data:
                f.write(f'{b:02X}\n')

if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2], sys.argv[3])
