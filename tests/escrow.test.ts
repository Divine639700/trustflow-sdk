import { EscrowBuilder } from '../src/escrow/builder';

describe('EscrowBuilder', () => {
  const ADDR_A = 'G' + 'A'.repeat(55);
  const ADDR_B = 'G' + 'B'.repeat(55);

  it('builds valid escrow params', () => {
    const params = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('100').build();
    expect(params.depositor).toBe(ADDR_A);
    expect(params.amountXLM).toBe('100');
  });

  it('throws if depositor missing', () => {
    expect(() => new EscrowBuilder().setBeneficiary(ADDR_B).setAmount('1').build()).toThrow('depositor required');
  });

  it('sets optional deadline', () => {
    const p = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('50').setDeadline(1000).build();
    expect(p.deadlineBlocks).toBe(1000);
  });

  describe('build() returns an independent snapshot', () => {
    it('returns a different object on every call', () => {
      const builder = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('1');

      expect(builder.build()).not.toBe(builder.build());
    });

    it('a set* call after build() does not change an earlier snapshot', () => {
      const builder = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('1');

      const first = builder.build();
      builder.setAmount('2');
      const second = builder.build();

      expect(first.amountXLM).toBe('1');
      expect(second.amountXLM).toBe('2');
      expect(first).toEqual({ depositor: ADDR_A, beneficiary: ADDR_B, amountXLM: '1' });
    });

    it('a set* call after build() is still visible to the next build()', () => {
      const builder = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('1');

      builder.build();
      builder.setAmount('2').setDeadline(1000).setToken('C' + 'C'.repeat(55));

      expect(builder.build()).toMatchObject({
        amountXLM: '2',
        deadlineBlocks: 1000,
        tokenAddress: 'C' + 'C'.repeat(55),
      });
    });

    it('mutating a built object does not change the next build()', () => {
      const builder = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('1');

      const first = builder.build();
      first.depositor = 'MUTATED';
      first.amountXLM = '999';

      expect(builder.build().depositor).toBe(ADDR_A);
      expect(builder.build().amountXLM).toBe('1');
    });

    it('mutating a built object does not affect earlier snapshots', () => {
      const builder = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B).setAmount('1');

      const first = builder.build();
      const second = builder.build();
      (second as { amountXLM: string }).amountXLM = '999';

      expect(first.amountXLM).toBe('1');
    });

    it('a builder reused as a template yields one independent object per gig', () => {
      const template = new EscrowBuilder().setDepositor(ADDR_A).setBeneficiary(ADDR_B);

      const gigs = ['10', '20', '30'].map((amount) => template.setAmount(amount).build());

      expect(gigs.map((g) => g.amountXLM)).toEqual(['10', '20', '30']);
      expect(gigs.every((g) => g.depositor === ADDR_A)).toBe(true);
      // Each gig must get its own object; none of them may be the builder's
      // internal state, otherwise gig 1 would end up holding gig 3's amount.
      expect(new Set(gigs).size).toBe(3);
    });
  });
});
