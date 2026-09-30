import * as SDK from '../src/index';
import * as EscrowBarrel from '../src/escrow/index';

describe('SDK Barrel Public Export Surface Integration Tests', () => {
    // Maintained allowlist tracking expected exported public modules to catch accidental drop drift
    const expectedExports = [
        'MultiSigEscrowClient',
        'TrustFlowClient',
        'TrustFlowError'
    ];

    it('should assert all core modules and clients are correctly exported from the public entry point', () => {
        const actualExports = Object.keys(SDK);
        
        for (const exportName of expectedExports) {
            expect(actualExports).toContain(exportName);
        }
    });

    it('should explicitly guarantee TrustFlowError is exported from the entry barrel surface', () => {
        expect(SDK).toHaveProperty('TrustFlowError');
    });

    it('exports disputeEscrow from both the package root and the escrow barrel', () => {
        expect(typeof SDK.disputeEscrow).toBe('function');
        expect(typeof EscrowBarrel.disputeEscrow).toBe('function');
        expect(SDK.disputeEscrow).toBe(EscrowBarrel.disputeEscrow);
    });

    it('exports DisputeClient from both the package root and the escrow barrel', () => {
        expect(SDK.DisputeClient).toBe(EscrowBarrel.DisputeClient);
    });

    it('makes the dispute and monitor option types nameable from the package root', () => {
        const options: SDK.DisputeClientOptions = {};
        const phase: SDK.EscrowMonitorErrorPhase = 'fetch';
        const onError: SDK.EscrowMonitorOnError = (_error: unknown, _context: SDK.EscrowMonitorErrorContext) => {};
        expect(options).toEqual({});
        expect(phase).toBe('fetch');
        expect(typeof onError).toBe('function');
    });
});
