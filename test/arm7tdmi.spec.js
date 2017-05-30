import ARM7TDMI from '../src/arm7tdmi';
import MMU from '../src/mmu';
import * as c from '../src/constants';
import Utils from '../src/utils';
import {describe, beforeEach, it} from 'mocha';
import {assert} from 'chai';

describe('ARM7TDMI tests', () => {
  let cpu;
  beforeEach(() => {
    cpu = new ARM7TDMI(new MMU());
    /**
     * @param {number} word
     * @param {number} offset
     */
    cpu.writeWord = function(word, offset) {
      this._mmu.writeWord(word, offset);
    };
    /**
     * @param {number} offset
     */
    cpu.readWord = function(offset) {
      return this._mmu.readWord(offset);
    };
    /**
     * @param {number} pc
     */
    cpu.setPC = function(pc) {
      this._r.pc = pc;
    };
    /**
     * @return {number} pc
     */
    cpu.getPC = function() {
      return this._r.pc;
    };
    /**
     * @param {number} word
     */
    cpu.setR1 = function(word) { this._r.r1 = word; };
    cpu.setR2 = function(word) { this._r.r2 = word; };
    cpu.setR3 = function(word) { this._r.r3 = word; };
    cpu.setR14 = function(word) { this._r.r14 = word; };
    cpu.getR14 = function() { return this._r.r14 };
    /**
     * @param {number} word
     */
    cpu.setCPSR = function(word) {
      this._r.cpsr = word;
    };
    cpu.getFetched = function() {
      return this._fetched;
    };
    cpu.setFetched = function(pc, word) {
      this._fetched = [pc, word];
    };
    cpu.getDecoded = function() {
      return this._decoded;
    };
    cpu.setDecoded = function(array) {
      this._decoded = array;
      this._logPC = 0;
    };
  });
  describe('Read/Write memory', () => {
    it('should read a memory array', () => {
      cpu.writeWord(0x01020304, 0x100);
      assert.equal(cpu.readWord(0x100), 0x04030201);
    });
  });
  describe('Registrers', () => {
    it('should read NZCVQ flags', () => {
      cpu.setCPSR(0xf8000000);
      assert.equal(cpu.getNZCVQ(), 0b11111);
    });
  });
  describe('Instruction pipeline', () => {
    it('should execute instructions in a pipeline', () => {
      const pc = 0;
      cpu.setPC(pc + 8);
      cpu.setFetched(4, 0xe3510000);
      cpu.setDecoded(['cmp', 0, 0]);
      cpu.setR1(1);
      cpu.setR2(2);
      cpu.setR3(3);
      cpu.writeWord(0x000053e3, pc + 8); // cmp r3,#0
      cpu.writeWord(0x000054e3, pc + 12); // cmp r4,#0

      cpu.cycle();
      assert.equal(cpu.getPC(), pc + 12);
      assert.deepEqual(cpu.getFetched(), [8, 0xe3530000]);
      assert.deepEqual(cpu.getDecoded(), ['cmp', 1, 0]);

      cpu.cycle();
      assert.equal(cpu.getPC(), pc + 16);
      assert.deepEqual(cpu.getFetched(), [12, 0xe3540000]);
      assert.deepEqual(cpu.getDecoded(), ['cmp', 3, 0]);
    });
    it('should fetch, decode and execute an branching instruction', () => {
      const pc = 0;
      cpu.setPC(pc + 8);
      cpu.setFetched(4, 0); // nop
      cpu.setDecoded(['nop']);
      cpu.writeWord(0x180000ea, 8); // b 0x70
      cpu.writeWord(0x00005ee3, 0x70); // cmp r14,#0
      cpu.writeWord(0xffffffff, 0x74); // rubbish

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [8, 0xea000018]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), pc + 12);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0x70, 0xe35e0000]);
      assert.deepEqual(cpu.getDecoded(), ['b', 0x70]);
      assert.equal(cpu.getPC(), pc + 16);

      cpu.cycle(); // execute branch
      assert.deepEqual(cpu.getFetched(), [0x74, 0xffffffff]);
      assert.deepEqual(cpu.getDecoded(), ['cmp', 0, 0]);
      assert.equal(cpu.getPC(), 0x70 + 8);
    });
  });
  describe('Branch', () => {
    it('should branch forward', () => {
      const pc = 0;
      const offset = 0x0a000000; // 10
      const calcOffset = Utils.toSigned(Utils.reverseBytes(offset))*4 + 8 + 8;
      cpu.setPC(pc + 8);
      cpu.writeWord(0x000000ea + offset, 8);

      cpu.cycle(); // fetch
      assert.deepEqual(cpu.getFetched(), [8, 0xea00000a]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), pc + 12);

      cpu.cycle(); // decode
      assert.deepEqual(cpu.getFetched(), [0x38, 0]); // fetch from 10*4 + 8 + 8
      assert.deepEqual(cpu.getDecoded(), ['b', 0x38]);
      assert.equal(cpu.getPC(), pc + 16);

      cpu.cycle(); // branch forward
      assert.equal(calcOffset, 0x38 /* 10*4 + pc + 8 */);
      assert.deepEqual(cpu.getFetched(), [0x38+4, 0]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), 0x38 + 8);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0x38+8, 0]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), 0x38 + 12);
    });
    it('should branch backwards', () => {
      const pc = 0x100;
      const offset = 0xf6ffff00; // -10
      const calcOffset = Utils.toSigned(Utils.reverseBytes(offset))*4 + pc+8 + 8;
      cpu.setPC(pc + 8);
      cpu.writeWord(0x000000ea + offset, 0x108);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0x108, 0xeafffff6]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), pc + 12);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0xe8, 0]); // fetch from -10*4 + 8 + 0x108 = 0xe8
      assert.deepEqual(cpu.getDecoded(), ['b', 0xe8]);
      assert.equal(cpu.getPC(), pc + 16);

      cpu.cycle(); // branch backwards
      assert.equal(calcOffset, 0xe8 /* -10*4 + 0x108 + 8 */);
      assert.deepEqual(cpu.getFetched(), [0xe8+4, 0]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), 0xe8 + 8);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0xe8+8, 0]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), 0xe8 + 12);
    });
    it('should branch to the same address (stuck)', () => {
      const pc = 0x100;
      const offset = 0xfeffff00; // -2
      const calcOffset = Utils.toSigned(Utils.reverseBytes(offset))*4 + pc+8 + 8;
      cpu.setPC(pc + 8);
      cpu.writeWord(0x000000ea + offset, 0x108);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0x108, 0xeafffffe]);
      assert.deepEqual(cpu.getDecoded(), ['nop']);
      assert.equal(cpu.getPC(), pc + 12);

      cpu.cycle();
      assert.deepEqual(cpu.getFetched(), [0x108, 0xeafffffe]); // fetch from -2*4 + 8 + 0x108 = 0x108
      assert.deepEqual(cpu.getDecoded(), ['b', 0x108]);
      assert.equal(cpu.getPC(), pc + 16);

      cpu.cycle(); // branch at the same address
      assert.equal(calcOffset, 0x108 /* -2*4 + 0x108 + 8 */);
      assert.deepEqual(cpu.getFetched(), [0x108, 0xeafffffe]); // fetch again from 0x108
      assert.deepEqual(cpu.getDecoded(), ['b', 0x108]);
      assert.equal(cpu.getPC(), 0x108 + 8);

      cpu.cycle(); // branch at the same address
      assert.deepEqual(cpu.getFetched(), [0x108, 0xeafffffe]); // fetch again from 0x108
      assert.deepEqual(cpu.getDecoded(), ['b', 0x108]);
      assert.equal(cpu.getPC(), 0x108 + 8);
    });
    // TODO: test offsets in memory boundaries.
  });
  describe('Compare', () => {
    it('should compare two numbers', () => {
      const pc = cpu.getPC();
      cpu.setR14(1);
      cpu.setDecoded(['cmp', cpu.getR14(), 1]);

      cpu.cycle();
      assert.equal(cpu.getNZCVQ(), 0b01000);
      assert.equal(cpu.getPC(), pc + 4);
    });
  });
});