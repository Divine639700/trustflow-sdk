import { toBaseUnits, fromBaseUnits, stroopsToXLM, parseAmount, formatAmount } from '../src/utils/format';
import { xlmToStroops } from '../src/utils/validation';
import { TrustFlowError } from '../src/errors';

describe('Base units conversion (#209)', () => {
  describe('toBaseUnits', () => {
    it('converts standard amounts accurately', () => {
      expect(toBaseUnits('1', 7)).toBe(10_000_000n);
      expect(toBaseUnits('1.5', 7)).toBe(15_000_000n);
      expect(toBaseUnits('0.0000001', 7)).toBe(1n);
      expect(toBaseUnits('100.1234567', 7)).toBe(1001234567n);
      expect(toBaseUnits('0', 7)).toBe(0n);
      expect(toBaseUnits('0.00', 7)).toBe(0n);
      expect(toBaseUnits('.5', 7)).toBe(5_000_000n);
    });

    it('handles custom decimals', () => {
      expect(toBaseUnits('1.234', 3)).toBe(1234n);
      expect(toBaseUnits('10', 0)).toBe(10n);
      expect(toBaseUnits('1.5', 18)).toBe(1500000000000000000n);
    });

    it('handles negative amounts', () => {
      expect(toBaseUnits('-1.5', 7)).toBe(-15_000_000n);
      expect(toBaseUnits('-0.0000001', 7)).toBe(-1n);
      expect(toBaseUnits('-100', 7)).toBe(-1000_000_000n);
    });

    it('rejects scientific notation', () => {
      expect(() => toBaseUnits('1e-7', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('1E5', 7)).toThrow(TrustFlowError);
    });

    it('rejects fractional parts exceeding decimals', () => {
      expect(() => toBaseUnits('1.12345678', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('0.12', 1)).toThrow(TrustFlowError);
    });

    it('rejects invalid strings and empty inputs', () => {
      expect(() => toBaseUnits('', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('   ', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('abc', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('1.2.3', 7)).toThrow(TrustFlowError);
      expect(() => toBaseUnits(123 as any, 7)).toThrow(TrustFlowError);
    });

    it('rejects invalid decimals parameter', () => {
      expect(() => toBaseUnits('1', -1)).toThrow(TrustFlowError);
      expect(() => toBaseUnits('1', 1.5)).toThrow(TrustFlowError);
    });
  });

  describe('fromBaseUnits', () => {
    it('formats bigint amounts to decimal string trimming trailing zeros', () => {
      expect(fromBaseUnits(10_000_000n, 7)).toBe('1');
      expect(fromBaseUnits(15_000_000n, 7)).toBe('1.5');
      expect(fromBaseUnits(1n, 7)).toBe('0.0000001');
      expect(fromBaseUnits(1001234567n, 7)).toBe('100.1234567');
      expect(fromBaseUnits(0n, 7)).toBe('0');
    });

    it('formats negative amounts correctly', () => {
      expect(fromBaseUnits(-15_000_000n, 7)).toBe('-1.5');
      expect(fromBaseUnits(-1n, 7)).toBe('-0.0000001');
      expect(fromBaseUnits(-1000_000_000n, 7)).toBe('-100');
    });

    it('accepts integer numbers and integer strings', () => {
      expect(fromBaseUnits(10000000, 7)).toBe('1');
      expect(fromBaseUnits('15000000', 7)).toBe('1.5');
      expect(fromBaseUnits('-15000000', 7)).toBe('-1.5');
    });

    it('rejects unsafe or non-integer numbers', () => {
      expect(() => fromBaseUnits(1.5, 7)).toThrow(TrustFlowError);
      expect(() => fromBaseUnits(Number.MAX_SAFE_INTEGER + 10, 7)).toThrow(TrustFlowError);
      expect(() => fromBaseUnits('not-an-int', 7)).toThrow(TrustFlowError);
    });
  });

  describe('stroopsToXLM, parseAmount, xlmToStroops, formatAmount', () => {
    it('roundtrips properly', () => {
      const amounts = ['1', '1.5', '0.0000001', '500.25', '1000000'];
      for (const amt of amounts) {
        const stroops = xlmToStroops(amt);
        expect(stroopsToXLM(stroops)).toBe(amt);
        expect(parseAmount(amt)).toBe(stroops);
        expect(formatAmount(stroops)).toBe(amt);
      }
    });

    it('handles negative stroopsToXLM properly', () => {
      expect(stroopsToXLM(-15_000_000n)).toBe('-1.5');
      expect(stroopsToXLM('-15000000')).toBe('-1.5');
    });
  });
});
