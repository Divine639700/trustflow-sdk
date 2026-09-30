import {
  TokenRefreshManager,
  decodeJwtExpMs,
  type TokenRefreshListener,
  type TokenRefreshConfig,
} from '../src/auth/tokenRefresh';
import {
  saveSession,
  loadSession,
  clearSession,
  configureSessionStorage,
  resetSessionStorage,
  type SessionStorageAdapter,
} from '../src/auth/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake JWT with a specific `exp` (UNIX seconds). */
function fakeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ sub: 'GTEST', exp: expSeconds })).toString('base64');
  const signature = 'fake-signature';
  return `${header}.${payload}.${signature}`;
}

/** In-memory storage adapter for test isolation. */
function createTestStorage(): SessionStorageAdapter & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get: (k: string) => data[k] ?? null,
    set: (k: string, v: string) => {
      data[k] = v;
    },
    remove: (k: string) => {
      delete data[k];
    },
  };
}

// ---------------------------------------------------------------------------
// Mock the HTTP client so no real network calls are made
// ---------------------------------------------------------------------------

let mockPostResponse: { data: { token: string } } | Error = { data: { token: '' } };
let mockPostCallCount = 0;

jest.mock('../src/utils/http', () => ({
  createApiHttpClient: () => ({
    post: async (_url: string, _body: unknown, _config?: unknown) => {
      mockPostCallCount++;
      if (mockPostResponse instanceof Error) throw mockPostResponse;
      return mockPostResponse;
    },
    get: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decodeJwtExpMs', () => {
  it('returns expiry in milliseconds from a valid JWT', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    const token = fakeJwt(expSeconds);
    expect(decodeJwtExpMs(token)).toBe(expSeconds * 1000);
  });

  it('returns null for a token with no exp claim', () => {
    const header = Buffer.from('{"alg":"HS256"}').toString('base64');
    const payload = Buffer.from('{"sub":"GTEST"}').toString('base64');
    expect(decodeJwtExpMs(`${header}.${payload}.sig`)).toBeNull();
  });

  it('returns null for a malformed token (not 3 parts)', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeNull();
    expect(decodeJwtExpMs('')).toBeNull();
  });

  it('returns null for unparseable payload', () => {
    expect(decodeJwtExpMs('a.!!!.c')).toBeNull();
  });
});

describe('TokenRefreshManager', () => {
  let storage: ReturnType<typeof createTestStorage>;

  beforeEach(() => {
    jest.useFakeTimers();
    storage = createTestStorage();
    configureSessionStorage(storage);
    mockPostCallCount = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSessionStorage();
    clearSession();
  });

  // -------------------------------------------------------------------------
  // Timer scheduling
  // -------------------------------------------------------------------------

  describe('timer scheduling', () => {
    it('schedules a refresh 60s before token expiry', () => {
      const expSeconds = Math.floor(Date.now() / 1000) + 600; // 10 min from now
      const token = fakeJwt(expSeconds);
      saveSession(token, 'GTEST', expSeconds * 1000);

      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();

      // Timer should be set but not yet fired
      expect(manager.isRefreshing).toBe(false);

      manager.stop();
    });

    it('triggers immediate refresh when token is near expiry', () => {
      const expSeconds = Math.floor(Date.now() / 1000) + 30; // 30s left (< 60s lead)
      const token = fakeJwt(expSeconds);
      saveSession(token, 'GTEST', expSeconds * 1000);

      // Set up a valid response token for the refresh
      const newExpSeconds = Math.floor(Date.now() / 1000) + 3600;
      mockPostResponse = { data: { token: fakeJwt(newExpSeconds) } };

      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();

      // Should have initiated a refresh immediately
      expect(manager.isRefreshing).toBe(true);

      manager.stop();
    });

    it('does nothing when no session exists', () => {
      clearSession();
      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();
      expect(manager.isRefreshing).toBe(false);
      manager.stop();
    });

    it('does nothing when the token has no decodable exp', () => {
      // Save a session with a non-JWT token
      saveSession('not-a-jwt', 'GTEST', Date.now() + 600_000);
      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();
      expect(manager.isRefreshing).toBe(false);
      manager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Silent refresh
  // -------------------------------------------------------------------------

  describe('silent refresh', () => {
    it('refreshes the token and persists the new session', async () => {
      // Current token expires in 30s (inside margin → immediate refresh)
      const currentExp = Math.floor(Date.now() / 1000) + 30;
      const currentToken = fakeJwt(currentExp);
      saveSession(currentToken, 'GTEST', currentExp * 1000);

      // Backend returns a fresh token valid for 1 hour
      const newExp = Math.floor(Date.now() / 1000) + 3600;
      const newToken = fakeJwt(newExp);
      mockPostResponse = { data: { token: newToken } };

      const onRefresh = jest.fn();
      const manager = new TokenRefreshManager({
        apiUrl: 'https://api.test',
        listener: { onRefresh },
      });

      manager.start();
      const refreshed = await manager.waitForRefresh();

      expect(refreshed).not.toBeNull();
      expect(refreshed!.token).toBe(newToken);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(mockPostCallCount).toBe(1);

      // The persisted session should be updated
      const stored = loadSession();
      expect(stored!.token).toBe(newToken);

      manager.stop();
    });

    it('invokes onRefreshError when the backend call fails', async () => {
      const currentExp = Math.floor(Date.now() / 1000) + 30;
      saveSession(fakeJwt(currentExp), 'GTEST', currentExp * 1000);

      mockPostResponse = new Error('network down');

      const onRefreshError = jest.fn();
      const manager = new TokenRefreshManager({
        apiUrl: 'https://api.test',
        listener: { onRefreshError },
      });

      manager.start();
      // waitForRefresh should return the old session on failure (not throw)
      const result = await manager.waitForRefresh();
      expect(result).not.toBeNull();
      expect(onRefreshError).toHaveBeenCalledTimes(1);

      manager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Single-flight / request queuing
  // -------------------------------------------------------------------------

  describe('single-flight and request queuing', () => {
    it('coalesces concurrent waitForRefresh calls into one HTTP request', async () => {
      const currentExp = Math.floor(Date.now() / 1000) + 30;
      saveSession(fakeJwt(currentExp), 'GTEST', currentExp * 1000);

      const newExp = Math.floor(Date.now() / 1000) + 3600;
      mockPostResponse = { data: { token: fakeJwt(newExp) } };

      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();

      // Issue three concurrent waits — all should share a single POST
      const [r1, r2, r3] = await Promise.all([
        manager.waitForRefresh(),
        manager.waitForRefresh(),
        manager.waitForRefresh(),
      ]);

      expect(r1!.token).toBe(r2!.token);
      expect(r2!.token).toBe(r3!.token);
      expect(mockPostCallCount).toBe(1); // Only one HTTP call

      manager.stop();
    });

    it('returns the current session immediately when no refresh is in-flight', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = fakeJwt(exp);
      saveSession(token, 'GTEST', exp * 1000);

      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      // Don't start — no timer, no refresh
      const session = await manager.waitForRefresh();

      expect(session!.token).toBe(token);
      expect(mockPostCallCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scope isolation
  // -------------------------------------------------------------------------

  describe('scope isolation', () => {
    it('refreshes only the scoped session, leaving other scopes intact', async () => {
      const exp = Math.floor(Date.now() / 1000) + 30;
      const tokenA = fakeJwt(exp);
      const tokenB = fakeJwt(exp);
      saveSession(tokenA, 'GALICE', exp * 1000, 'alice');
      saveSession(tokenB, 'GBOB', exp * 1000, 'bob');

      const newExp = Math.floor(Date.now() / 1000) + 3600;
      const newTokenA = fakeJwt(newExp);
      mockPostResponse = { data: { token: newTokenA } };

      // Refresh only Alice's scope
      const manager = new TokenRefreshManager({
        apiUrl: 'https://api.test',
        scope: 'alice',
      });
      manager.start();
      await manager.waitForRefresh();

      // Alice should have the new token
      expect(loadSession('alice')!.token).toBe(newTokenA);
      // Bob should be unchanged
      expect(loadSession('bob')!.token).toBe(tokenB);

      manager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // stop() lifecycle
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('cancels a pending timer so no refresh fires', () => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      saveSession(fakeJwt(exp), 'GTEST', exp * 1000);

      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      manager.start();
      manager.stop();

      // Advance time past the scheduled point — nothing should happen
      jest.advanceTimersByTime(600_000);
      expect(mockPostCallCount).toBe(0);
    });

    it('is safe to call multiple times', () => {
      const manager = new TokenRefreshManager({ apiUrl: 'https://api.test' });
      expect(() => {
        manager.stop();
        manager.stop();
      }).not.toThrow();
    });
  });
});
