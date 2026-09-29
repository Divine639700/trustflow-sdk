import * as fs from 'fs';
import * as path from 'path';
import { submitTransaction } from '../src/stellar/transaction';
import * as stellarBarrel from '../src/stellar';

/**
 * #110 — there was a dead duplicate `submitTransaction` in
 * `src/stellar/horizon.ts` (orphaned: not on the barrel, no import sites). The
 * used implementation lives in `src/stellar/transaction.ts`. Only one may exist.
 */
describe('src/stellar submitTransaction (#110)', () => {
  const stellarDir = path.resolve(__dirname, '../src/stellar');

  it('has exactly one implementation across src/stellar', () => {
    const withImpl = fs
      .readdirSync(stellarDir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /export\s+async\s+function\s+submitTransaction\b/.test(
          fs.readFileSync(path.join(stellarDir, file), 'utf8'),
        ),
      );
    expect(withImpl).toEqual(['transaction.ts']);
  });

  it('src/stellar/horizon.ts no longer exists', () => {
    expect(fs.existsSync(path.join(stellarDir, 'horizon.ts'))).toBe(false);
  });

  it('the surviving implementation takes (xdr, horizonUrl, retry?, timeoutMs?) and is the one on the barrel', () => {
    expect(typeof submitTransaction).toBe('function');
    // `(xdr, horizonUrl)` are still the first two required parameters; the
    // optional third is the ApiRetryConfig retry budget and the optional
    // fourth is the request timeout in milliseconds.
    const signature = fs.readFileSync(path.join(stellarDir, 'transaction.ts'), 'utf8');
    expect(signature).toMatch(
      /export async function submitTransaction\(\s*xdr: string,\s*horizonUrl: string,\s*retry\?: ApiRetryConfig,\s*timeoutMs\?: number,?\s*\)/,
    );
    expect((stellarBarrel as { submitTransaction?: unknown }).submitTransaction).toBe(
      submitTransaction,
    );
  });

  it('src/stellar/rpc.ts no longer exists and simulateAndAssemble is not exported', () => {
    expect(fs.existsSync(path.join(stellarDir, 'rpc.ts'))).toBe(false);
    expect('simulateAndAssemble' in stellarBarrel).toBe(false);
  });
});
