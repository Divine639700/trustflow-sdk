/**
 * Account contexts.
 *
 * A `TrustFlowClient` used to model exactly one active account: everything
 * that needed a second identity (a second signer, a fee source, an arbitrator
 * watching escrows it did not create) required constructing a second client,
 * which duplicated the Horizon/Soroban connections, the balance cache and the
 * retry budget. An {@link AccountContext} is the unit of identity instead, and
 * {@link import('./manager').AccountManager} holds many of them in one client.
 *
 * An account context is *identity plus per-account state* — an address, an
 * optional API key, roles, and a free-form `data` bag that the SDK never reads
 * but that callers use to scope their own caches. Nothing in a context is
 * shared with any other context, so switching accounts can never leak one
 * account's balance, session or credentials into another's call.
 */

/**
 * Well-known roles an account may hold, for readable call sites. Custom
 * strings are allowed, so integrators can carry their own vocabulary.
 */
export type AccountRole =
  | 'depositor'
  | 'beneficiary'
  | 'arbitrator'
  | 'fee-source'
  | 'admin'
  | (string & {});

/** One identity managed by a {@link import('./manager').AccountManager}. */
export interface AccountContext {
  /**
   * Stable key used to reference this account within its client. Defaults to
   * {@link AccountContext.address}. Two contexts for the same address can
   * coexist under different ids (e.g. a wallet connection and the keypair
   * behind it), which is why lookups also accept an address.
   */
  readonly id: string;
  /** Stellar account this context acts as — a `G...` public key. */
  readonly address: string;
  /** Optional display label, e.g. `"Alice (depositor)"`. */
  readonly label?: string;
  /**
   * Per-account API key, used for backend requests made on this account's
   * behalf. Falls back to the client's `apiKey` when omitted, so a client-wide
   * key keeps working unchanged.
   */
  readonly apiKey?: string;
  /** Roles this account holds, for readable call sites and UI gating. */
  readonly roles: AccountRole[];
  /**
   * Free-form per-account state. The SDK never reads or writes these keys; it
   * only guarantees they are not shared between accounts.
   */
  readonly data: Record<string, unknown>;
  /** UNIX ms timestamp of registration. */
  readonly createdAt: number;
  /** UNIX ms timestamp of the account's most recent use, if any. */
  readonly lastUsedAt?: number;
}

/** Registration input for {@link import('./manager').AccountManager.add}. */
export interface AddAccountInput {
  /** Stellar `G...` public key. Required. */
  address: string;
  /** Optional id; defaults to `address`. */
  id?: string;
  /** Optional display label. */
  label?: string;
  /** Per-account API key for backend calls. */
  apiKey?: string;
  /** Roles the account holds. */
  roles?: AccountRole[];
  /** Initial per-account state. */
  data?: Record<string, unknown>;
  /**
   * Make this the active account on registration. Defaults to `true` for the
   * first account and `false` afterwards, so a pre-populated account list
   * activates the entry the caller listed first and never silently steals
   * focus from an account the app already switched to.
   */
  activate?: boolean;
}

/** Mutable fields of an {@link AccountContext}. */
export type AccountPatch = Partial<Pick<AccountContext, 'label' | 'apiKey' | 'roles' | 'data'>>;

/**
 * Every method that operates in an account context accepts this, so a caller
 * can target a specific account for one call without disturbing the active
 * one.
 *
 * Omitting `account` uses {@link import('./manager').AccountManager.active}.
 * When no account is active either — the single-account case every existing
 * integration is in — the call behaves exactly as it did before multi-account
 * support, with no account context attached.
 */
export interface AccountOptions {
  /**
   * Account id or `G...` address to act as. Defaults to the active account.
   * An id or address that is not registered throws a `TrustFlowError` with
   * code `ACCOUNT_NOT_FOUND`.
   */
  account?: string;
}

/** Emitted to {@link import('./manager').AccountManager.onChange} listeners. */
export type AccountChangeEvent =
  | { type: 'added'; account: AccountContext }
  | { type: 'updated'; account: AccountContext; previous: AccountContext }
  | { type: 'removed'; account: AccountContext }
  | { type: 'activated'; account: AccountContext; previousId: string | null };

/** Listener registered with {@link import('./manager').AccountManager.onChange}. */
export type AccountChangeListener = (event: AccountChangeEvent) => void;

/**
 * Serialisable form of an {@link AccountContext}, as produced by
 * {@link import('./manager').AccountManager.exportState}.
 */
export interface AccountSnapshot {
  id: string;
  address: string;
  label?: string;
  apiKey?: string;
  roles: AccountRole[];
  data: Record<string, unknown>;
  createdAt: number;
  lastUsedAt?: number;
}

/**
 * Serialisable form of a whole account manager, as produced by
 * {@link import('./manager').AccountManager.exportState}. The id in
 * {@link AccountManagerSnapshot.activeId} refers to {@link AccountSnapshot.id}.
 */
export interface AccountManagerSnapshot {
  /** Snapshot schema version. Bump when the shape changes incompatibly. */
  version: number;
  accounts: AccountSnapshot[];
  /** Id of the account to activate on import, if it survives the import. */
  activeId: string | null;
}
