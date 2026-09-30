/**
 * Example: request/response interceptors for logging, auth and transformation
 */
import { HttpInterceptors } from '../src/utils/interceptors';
import { ProfileClient } from '../src/profile/client';
import { DisputeClient } from '../src/escrow/dispute';

const interceptors = new HttpInterceptors();

// 1. Logging — time every request.
const startTimes = new WeakMap<object, number>();
interceptors.request.use((config) => {
  startTimes.set(config, Date.now());
  console.log(`→ ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});
interceptors.response.use(
  (response) => {
    const started = startTimes.get(response.config) ?? Date.now();
    console.log(`← ${response.status} ${response.config.url} (${Date.now() - started}ms)`);
    return response;
  },
  (error) => {
    console.error('✗ request failed:', error);
    throw error;
  },
);

// 2. Authentication — attach a fresh token before each request (async).
async function getAccessToken(): Promise<string> {
  return process.env.TRUSTFLOW_API_TOKEN ?? '';
}
interceptors.request.use(async (config) => {
  config.headers.set('Authorization', `Bearer ${await getAccessToken()}`);
  return config;
});

// 3. Custom headers — tracing / proxy headers.
interceptors.request.use((config) => {
  config.headers.set('X-Request-Id', Math.random().toString(36).slice(2));
  return config;
});

// 4. Transformation — unwrap `{ data: ... }` envelopes returned by a proxy.
const unwrapId = interceptors.response.use((response) => {
  const body = response.data as { data?: unknown };
  return body && typeof body === 'object' && 'data' in body
    ? { ...response, data: body.data }
    : response;
});

async function main() {
  const apiUrl = 'https://api.trustflow.dev';

  // Share the same interceptors across clients.
  const profiles = new ProfileClient(apiUrl, 'token', { interceptors });
  const disputes = new DisputeClient(
    {
      contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
      network: 'TESTNET',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      apiBaseUrl: apiUrl,
      apiKey: 'token',
    },
    { interceptors },
  );

  console.log(await profiles.getProfile('GABC...'));
  void disputes;

  // Interceptors can be removed at any time.
  interceptors.response.eject(unwrapId);
}

main().catch(console.error);
