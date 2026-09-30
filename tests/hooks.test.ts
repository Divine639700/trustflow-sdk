/** @jest-environment jsdom */
import * as hooks from '../src/hooks';

describe('hooks barrel', () => {
  it.each(['useWallet', 'useBalance', 'useTransaction', 'useEscrow'])('exports %s', (name) => {
    expect(typeof (hooks as unknown as Record<string, unknown>)[name]).toBe('function');
  });
});
