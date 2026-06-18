# RISC-V Single-Cycle Visualizer — Design Decisions

Fill in every answer before we write a single line of code.

---

## 1. Tech Stack

- Diagram rendering: **SVG** (inside HTML) vs Canvas?
  - SVG is easier to make interactive (click, hover on individual elements)
  - Canvas is better for high-performance animation
  - > Your answer: SVG

- JS: plain vanilla JS vs a framework (React, Vue, Svelte)?
  - > Your answer: Plain JS

- Any build step / bundler (Vite, Webpack) or just open index.html directly?
  - > Your answer: just index.html

---

## 2. Assembler

- Write our own minimal RV32I assembler in JS, or use an existing library?
  - > Your answer: write our own

- If writing our own, what do we support?
  - [ ] All 40 RV32I instructions
  - [ ] Pseudo-instructions (li, mv, j, ret, nop, la, …)
  - [ ] Labels (for branches/jumps)
  - [ ] Comments (# or //)
  - [ ] .data section (define memory contents)
  - > Your answer (check what you want): only the base 40 which we implmeneted in the RTL other than the Unified memory one, we hsuold have lables, 
  no pseudo instructins, yeah comments are fine we should account for those, and yeah hace a .data section as well

- What happens on an assembly error? (red underline in editor? alert? error panel?)
  - > Your answer: yeah red underline is good, we acn build an error checker in our assembler which keeps track of th eline 

---

## 3. Diagram Layout

- Overall flow direction: **left-to-right** (standard Harris & Harris style) vs top-to-bottom?
  - > Your answer: left to right, similar to the photo of the diagram ive upaoded 

- Navigation: **pan + zoom** (drag to move, scroll to zoom) vs plain scroll?
  - > Your answer: drag to move and scroll to zoom

- Wire routing style: orthogonal (90-degree corners) vs diagonal straight lines?
  - > Your answer: orthogoanl only 90 degree turns no diagonal wires musst be moving perfectly horizontal or vertical with 90 deg turns

- Which components get their own box on the diagram?
  - [ ] PC register
  - [ ] PC+4 adder
  - [ ] PC target adder (PC/rs1 + imm)
  - [ ] Next-PC mux
  - [ ] Instruction Memory (IMEM)
  - [ ] Field Extractor
  - [ ] Immediate Generator
  - [ ] Decoder / Control Unit
  - [ ] Register File (with all 32 registers visible)
  - [ ] ALU source mux A (rs1 vs PC)
  - [ ] ALU source mux B (rs2 vs imm)
  - [ ] ALU
  - [ ] Data Memory (DMEM)
  - [ ] Branch Logic
  - [ ] Writeback mux
  - > Your answer (remove any you don't want): look at the image ive uplaoded but only wires dont have a box signifying what they are rest everything does have a box

---

## 4. Wire Values

- Are wire values always visible, or only on hover?
  - > Your answer: always visible

- Format: hex (0x0000001F) vs decimal (31) vs both?
  - > Your answer: both 

- 1-bit control signals (branch, jump, reg_write_en, etc.) — shown as 0/1, true/false, or just color-coded?
  - > Your answer: shown as 0 or 1 and color coded

---

## 5. Color Coding

- Active path color vs inactive path color — do you have a preference (e.g. blue active / gray inactive)?
  - > Your answer: blue active grey inactive is fine for now

- Should control signal wires be a different color than data wires?
  - > Your answer: ake them orangey red

- Should the currently-written register in the regfile be highlighted?
  - > Your answer: yeah that would be good

- Should rs1 and rs2 (registers being read this cycle) also be highlighted differently?
  - > Your answer: yup good idea

---

## 6. Register File Display

- Show ABI names (zero, ra, sp, gp, a0 …) alongside x0-x31, or just xN?
  - > Your answer: no just x0 to x31

- Value format inside register boxes: hex, decimal, or toggle between both?
  - > Your answer: toggle between both is good

- 32 boxes arranged in a grid (e.g. 4 columns × 8 rows) or a single column?
  - > Your answer: two colums of 16 boxes each , the inside of the box is what the vlaue of the reg is outside on the left of the box is the reg number like x0. and the whole reg file is wrapped in a bigger box 

---

## 7. Component Box Internals

What should be visible *inside* each box? Examples:
- **PC box**: just the current PC value
- **ALU box**: inputs A and B, operation name, result
- **IMEM box**: raw hex instruction + decoded mnemonic
- **Decoder box**: all 10 control signal values
- **DMEM box**: address, write data, read data, we/re flags

Do you want all signals visible inside the box at all times, or just the most important ones with a click/hover to expand?
- > Your answer: start with all visbile we can decide specifics later if we want  to turn any off

---

## 8. Instruction Info Panel

- Separate panel (sidebar or top bar) showing the current instruction in plain English?
  - e.g. `Cycle 7 | ADD x5, x1, x2 | PC: 0x8000001C`
  - > Your answer: yes yes in a top bar across the page 

- Should it also show which instruction *type* it is (R-type, I-type, etc.)?
  - > Your answer: yeah sure

---

## 9. Program Input

- Where does the assembly editor live? (left sidebar / separate panel / modal popup?)
  - > Your answer:top left sidebar aread like a rectangle box

- Should there be a set of built-in example programs to pick from a dropdown?
  - If yes, what examples? (e.g. simple arithmetic, loop, fibonacci, memory load/store, …)
  - > Your answer: yeah thats a good diea simple example prpgrms would be good one which is alu depdnednt one branch one laod one store types

- After assembling, does the program auto-load and reset to cycle 0, or wait for user to press "Load"?
  - > Your answer: auto load

---

## 10. Playback Controls

- Controls location: top bar / bottom bar / floating?
  - > Your answer: top bar on the rigth of the incstrution being run

- Buttons needed:
  - [ ] Step forward (one cycle)
  - [ ] Step backward (requires storing history — do you want this?)
  - [ ] Play (auto-advance)
  - [ ] Pause
  - [ ] Reset (back to cycle 0)
  - > Your answer (check what you want): all of them are good imo

- Play speed: fixed, or a slider (e.g. 0.5 – 10 cycles/sec)?
  - > Your answer: fuxed maybe 1 cycle every 3 seconds or smth t

- Cycle counter visible somewhere?
  - > Your answer: yeah next to the contorls

---

## 11. Memory View

- Should DMEM contents be visible anywhere? (e.g. a collapsible panel showing memory addresses and values)
  - > Your answer: Demem is going to be a box, where you can see the values of anything stored in memory, anything exceeding ths space can be seen if you click into a little popup

---

## 12. Program End / ecall

- When the program hits `ecall`, what happens?
  - Stop automatically and show a result (PASS/FAIL based on a0)?
  - Just stop with a "program ended" message?
  - > Your answer: program ended message with the final state of the reg's and memory ands tuff saved

---

## 13. Styling / Theme

- Dark mode or light mode (or toggle)?
  - > Your answer: toggle

- Any specific color palette or aesthetic vibe? (minimal/clean, techy/terminal, colorful?)
  - > Your answer: techy terminal vibe would be cool but with fu colors for the idfrrent elements

---

## 14. Anything Else?

Any features or behaviors you want that aren't covered above?
- > Your answer:
