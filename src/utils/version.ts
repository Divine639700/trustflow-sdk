import axios, { AxiosInstance } from 'axios';
import { TrustFlowError } from '../errors';
import { SDK_VERSION, DEFAULT_API_VERSION } from '../constants';

export interface ApiVersionNegotiationResult {
  serverVersion: string;
  clientVersion: string;
  compatible: boolean;
  supportedVersions?: string[];
  warning?: string;
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(version: string): SemVer | null {
  if (!version || typeof version !== 'string') return null;
  const clean = version.trim().replace(/^[vV]/, '');
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
  };
}

export function isVersionCompatible(clientVersion: string, serverVersion: string): boolean {
  const client = parseSemVer(clientVersion);
  const server = parseSemVer(serverVersion);
  if (!client || !server) {
    return clientVersion.trim().toLowerCase() === serverVersion.trim().toLowerCase();
  }
  return client.major === server.major;
}

export function checkApiCompatibility(
  clientVersion: string,
  serverVersion: string,
): { compatible: boolean; warning?: string; reason?: string } {
  const client = parseSemVer(clientVersion);
  const server = parseSemVer(serverVersion);

  if (!client || !server) {
    const directMatch = clientVersion.trim().toLowerCase() === serverVersion.trim().toLowerCase();
    return {
      compatible: directMatch,
      warning: directMatch
        ? undefined
        : `Version string mismatch: client ${clientVersion}, server ${serverVersion}`,
      reason: directMatch ? undefined : 'Unrecognized or mismatched version string formats',
    };
  }

  if (client.major !== server.major) {
    return {
      compatible: false,
      reason: `Incompatible major version: client requires ^${client.major}.x, but server reports ${serverVersion}`,
    };
  }

  if (server.minor < client.minor) {
    return {
      compatible: true,
      warning: `Server version (${serverVersion}) is older than client expected minor version (${clientVersion}). Some newer features may not be supported by backend.`,
    };
  }

  return { compatible: true };
}

export async function negotiateApiVersion(
  apiBaseUrl: string,
  options?: {
    clientVersion?: string;
    httpClient?: AxiosInstance;
    timeoutMs?: number;
  },
): Promise<ApiVersionNegotiationResult> {
  const clientVersion = options?.clientVersion ?? DEFAULT_API_VERSION;
  const timeout = options?.timeoutMs ?? 5000;

  try {
    const client = options?.httpClient ?? axios.create({ baseURL: apiBaseUrl, timeout });
    const response = await client.get('/version', {
      headers: {
        'X-SDK-Version': SDK_VERSION,
        'X-API-Version': clientVersion,
      },
    });

    const serverVersion: string =
      (response.headers?.['x-api-version'] as string) ||
      (response.headers?.['x-server-version'] as string) ||
      response.data?.version ||
      response.data?.apiVersion ||
      'unknown';

    const supportedVersions = response.data?.supportedVersions;
    const compat = checkApiCompatibility(clientVersion, serverVersion);

    return {
      serverVersion,
      clientVersion,
      compatible: compat.compatible,
      supportedVersions,
      warning: compat.warning,
    };
  } catch (error: any) {
    const serverHeader = error?.response?.headers?.['x-api-version'];
    if (serverHeader) {
      const compat = checkApiCompatibility(clientVersion, serverHeader);
      return {
        serverVersion: serverHeader,
        clientVersion,
        compatible: compat.compatible,
        warning: compat.warning,
      };
    }
    throw TrustFlowError.wrap(error, 'CONNECTION_ERROR');
  }
}
