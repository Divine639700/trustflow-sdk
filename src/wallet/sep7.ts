import { xdr as stellarXdr } from '@stellar/stellar-sdk';
import { TrustFlowError } from '../errors';

/** Maximum byte-mode QR payload at version 40 with low error correction. */
export const SEP7_MAX_URI_LENGTH = 2953;

/** Options for a SEP-0007 transaction signing request. */
export interface Sep7Options {
  /** Absolute HTTP(S) endpoint that receives the signed XDR instead of wallet submission. */
  callbackUrl?: string;
  /** Text shown by the wallet; SEP-0007 limits this to 300 characters. */
  message?: string;
  /** Originating fully qualified domain. Wallets display it only after signature verification. */
  originDomain?: string;
  /** Required for transactions on networks other than the Stellar public network. */
  networkPassphrase?: string;
  /** Application-specific URI/QR size cap, in bytes (1–2953; default: 2953). */
  maxUriLength?: number;
}

/**
 * Encodes a prepared transaction envelope as a SEP-0007 signing URI.
 * The returned URI is also the complete payload to pass to a QR-code renderer.
 * This function does not sign the URI or the transaction.
 *
 * @param xdr - Base64-encoded Stellar TransactionEnvelope XDR
 * @param options - Optional callback, display and size settings
 * @returns A `web+stellar:tx` URI suitable for a deep link or QR-code payload
 * @throws {TrustFlowError} VALIDATION_ERROR for invalid input or an oversized URI
 *
 * @example
 * ```typescript
 * const uri = generateSep7Uri(unsignedXdr, {
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 *   message: 'Review escrow release',
 * });
 * // Feed `uri` directly to a QR-code renderer, or use it as a wallet deep link.
 * ```
 */
export function generateSep7Uri(xdr: string, options: Sep7Options = {}): string {
  const maxLength = options.maxUriLength ?? SEP7_MAX_URI_LENGTH;
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > SEP7_MAX_URI_LENGTH) {
    throw TrustFlowError.validation(
      'maxUriLength',
      `must be an integer from 1 to ${SEP7_MAX_URI_LENGTH}`,
    );
  }

  if (
    typeof xdr !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(xdr) ||
    xdr.length === 0
  ) {
    throw TrustFlowError.validation('xdr', 'must be base64-encoded transaction envelope XDR');
  }
  if (xdr.length > maxLength) {
    throw TrustFlowError.validation('uri', `exceeds the ${maxLength}-byte URI limit`);
  }
  try {
    stellarXdr.TransactionEnvelope.fromXDR(xdr, 'base64');
  } catch {
    throw TrustFlowError.validation('xdr', 'must be a Stellar transaction envelope');
  }

  const params = [`xdr=${encodeURIComponent(xdr)}`];
  if (options.callbackUrl !== undefined) {
    const callbackUrl = options.callbackUrl;
    let parsed: URL;
    try {
      parsed = new URL(callbackUrl);
    } catch {
      throw TrustFlowError.validation('callbackUrl', 'must be an absolute HTTP(S) URL');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      /\s/.test(callbackUrl)
    ) {
      throw TrustFlowError.validation('callbackUrl', 'must be an absolute HTTP(S) URL');
    }
    params.push(`callback=${encodeURIComponent(`url:${callbackUrl}`)}`);
  }
  if (options.message !== undefined) {
    if (typeof options.message !== 'string' || [...options.message].length > 300) {
      throw TrustFlowError.validation('message', 'must be at most 300 characters');
    }
    params.push(`msg=${encodeURIComponent(options.message)}`);
  }
  if (options.networkPassphrase !== undefined) {
    if (typeof options.networkPassphrase !== 'string' || !options.networkPassphrase) {
      throw TrustFlowError.validation('networkPassphrase', 'must be a non-empty string');
    }
    params.push(`network_passphrase=${encodeURIComponent(options.networkPassphrase)}`);
  }
  if (options.originDomain !== undefined) {
    const domain = options.originDomain;
    if (
      typeof domain !== 'string' ||
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
        domain,
      )
    ) {
      throw TrustFlowError.validation('originDomain', 'must be a fully qualified domain name');
    }
    params.push(`origin_domain=${encodeURIComponent(domain)}`);
  }

  const uri = `web+stellar:tx?${params.join('&')}`;
  if (uri.length > maxLength) {
    throw TrustFlowError.validation('uri', `exceeds the ${maxLength}-byte URI limit`);
  }
  return uri;
}
