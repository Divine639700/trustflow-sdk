import axios from 'axios';
import {
  parseSemVer,
  isVersionCompatible,
  checkApiCompatibility,
} from '../src/utils/version';
import { TrustFlowClient } from '../src/client';
import { createApiHttpClient } from '../src/utils/http';
import { SDK_VERSION, DEFAULT_API_VERSION } from '../src/constants';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('API Version Negotiation and Compatibility', () => {
  describe('SemVer parsing and compatibility', () => {
    it('parses semantic version strings correctly', () => {
      expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseSemVer('v2.0')).toEqual({ major: 2, minor: 0, patch: 0 });
      expect(parseSemVer('invalid')).toBeNull();
    });

    it('validates version compatibility correctly', () => {
      expect(isVersionCompatible('1.0.0', '1.2.0')).toBe(true);
      expect(isVersionCompatible('1.0.0', '2.0.0')).toBe(false);
      expect(isVersionCompatible('v1', 'v1')).toBe(true);
    });

    it('checks compatibility with warnings on minor mismatches', () => {
      const match = checkApiCompatibility('1.2.0', '1.2.0');
      expect(match.compatible).toBe(true);
      expect(match.warning).toBeUndefined();

      const olderServer = checkApiCompatibility('1.3.0', '1.1.0');
      expect(olderServer.compatible).toBe(true);
      expect(olderServer.warning).toBeDefined();

      const incompatible = checkApiCompatibility('1.0.0', '2.0.0');
      expect(incompatible.compatible).toBe(false);
      expect(incompatible.reason).toBeDefined();
    });
  });

  describe('HTTP Client Version Headers', () => {
    it('includes SDK and API version headers by default', () => {
      mockedAxios.create.mockReturnValue({} as any);
      createApiHttpClient({ baseURL: 'https://api.trustflow.xyz' });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-SDK-Version': SDK_VERSION,
            'X-API-Version': DEFAULT_API_VERSION,
          }),
        }),
      );
    });

    it('allows custom apiVersion in http client options', () => {
      mockedAxios.create.mockReturnValue({} as any);
      createApiHttpClient({ baseURL: 'https://api.trustflow.xyz', apiVersion: '2.0.0' });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Version': '2.0.0',
          }),
        }),
      );
    });
  });

  describe('TrustFlowClient Version Verification', () => {
    it('returns configured version headers in getAuthHeaders', () => {
      const client = new TrustFlowClient({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        apiVersion: '1.5.0',
      });

      const headers = client.getAuthHeaders();
      expect(headers['X-SDK-Version']).toBe(SDK_VERSION);
      expect(headers['X-API-Version']).toBe('1.5.0');
    });

    it('returns compatible immediately if apiBaseUrl is not configured', async () => {
      const client = new TrustFlowClient({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      });

      const res = await client.verifyApiCompatibility();
      expect(res.compatible).toBe(true);
      expect(res.serverVersion).toBe('N/A');
    });
  });
});
