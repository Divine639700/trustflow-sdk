import { TrustFlowError } from '../errors';

/**
 * Converts a decimal amount string to base units (e.g. XLM to stroops) with exact bigint arithmetic.
 *
 * @param amount - Decimal amount string (e.g. "1.5", "-0.0000001", "100")
 * @param decimals - Number of decimal places for base units (e.g. 7 for XLM/stroops)
 * @returns Amount in base units as a bigint
 * @throws {TrustFlowError} If the amount is invalid, has too many decimal places, or uses scientific notation
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  if (typeof amount !== 'string') {
    throw TrustFlowError.validation('amount', `Amount must be a string, got ${typeof amount}`);
  }
  const trimmed = amount.trim();
  if (!trimmed) {
    throw TrustFlowError.validation('amount', 'Amount string cannot be empty');
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw TrustFlowError.validation(
      'decimals',
      `Decimals must be a non-negative integer, got ${decimals}`,
    );
  }
  if (/[eE]/.test(trimmed)) {
    throw TrustFlowError.validation('amount', `Scientific notation is not supported: "${trimmed}"`);
  }
  const match = trimmed.match(/^([+-])?(\d+)?(?:\.(\d+))?$/);
  if (!match || (!match[2] && !match[3])) {
    throw TrustFlowError.validation('amount', `Invalid amount format: "${trimmed}"`);
  }
  const isNeg = match[1] === '-';
  const wholeStr = match[2] ?? '0';
  const fracStr = match[3] ?? '';

  if (fracStr.length > decimals) {
    throw TrustFlowError.validation(
      'amount',
      `Amount "${trimmed}" has ${fracStr.length} decimal places, exceeding maximum of ${decimals}`,
    );
  }

  const whole = BigInt(wholeStr) * 10n ** BigInt(decimals);
  const frac = fracStr ? BigInt(fracStr.padEnd(decimals, '0')) : 0n;
  const total = whole + frac;

  return isNeg ? -total : total;
}

/**
 * Converts base units to a human-readable decimal string with exact bigint arithmetic.
 *
 * @param amount - Amount in base units (bigint, integer number, or integer string)
 * @param decimals - Number of decimal places (e.g. 7 for XLM/stroops)
 * @returns Formatted decimal string with trailing zeros removed
 * @throws {TrustFlowError} If input is not an integer or decimals is negative
 */
export function fromBaseUnits(amount: bigint | number | string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw TrustFlowError.validation(
      'decimals',
      `Decimals must be a non-negative integer, got ${decimals}`,
    );
  }
  let big: bigint;
  if (typeof amount === 'bigint') {
    big = amount;
  } else if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw TrustFlowError.validation(
        'amount',
        `Conversion from base units requires an integer number, got ${amount}`,
      );
    }
    if (!Number.isSafeInteger(amount)) {
      throw TrustFlowError.validation(
        'amount',
        `Amount ${amount} exceeds Number.MAX_SAFE_INTEGER; use bigint or string`,
      );
    }
    big = BigInt(amount);
  } else if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw TrustFlowError.validation('amount', `Invalid base units integer string: "${amount}"`);
    }
    big = BigInt(trimmed);
  } else {
    throw TrustFlowError.validation(
      'amount',
      `Expected bigint, number, or string, got ${typeof amount}`,
    );
  }

  const isNeg = big < 0n;
  const absVal = isNeg ? -big : big;
  const divisor = 10n ** BigInt(decimals);
  const whole = absVal / divisor;
  const frac = absVal % divisor;
  const prefix = isNeg ? '-' : '';

  if (decimals === 0 || frac === 0n) {
    return `${prefix}${whole.toString()}`;
  }
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${prefix}${whole.toString()}.${fracStr}`;
}

/**
 * Converts stroops (smallest XLM unit) to a human-readable XLM string.
 *
 * @param stroops - Amount in stroops (1 XLM = 10,000,000 stroops)
 * @returns Formatted XLM string with up to 7 decimal places, trailing zeros removed
 *
 * @example
 * ```ts
 * stroopsToXLM(10_000_000n); // '1'
 * stroopsToXLM(1_500_000n);  // '0.15'
 * stroopsToXLM(123_456_789n); // '12.3456789'
 * ```
 */
export function stroopsToXLM(stroops: bigint | number | string): string {
  return fromBaseUnits(stroops, 7);
}

/**
 * Parses a human-readable XLM amount string into stroops.
 *
 * @param xlm - Amount in XLM (e.g., "1.5", "0.0000001")
 * @param decimals - Decimal places (defaults to 7 for XLM)
 * @returns Amount in stroops as bigint
 * @throws {TrustFlowError} If the input is not a valid XLM amount
 *
 * @example
 * ```ts
 * parseAmount('1');        // 10_000_000n
 * parseAmount('1.5');      // 15_000_000n
 * parseAmount('0.0000001'); // 1n
 * ```
 */
export function parseAmount(xlm: string | number, decimals = 7): bigint {
  return toBaseUnits(typeof xlm === 'string' ? xlm : String(xlm), decimals);
}

/**
 * Formats an amount in stroops to a human-readable XLM string.
 * Alias for {@link stroopsToXLM} for semantic clarity.
 *
 * @param stroops - Amount in stroops
 * @returns Formatted XLM string
 *
 * @example
 * ```ts
 * formatAmount(10_000_000n); // '1 XLM'
 * ```
 */
export function formatAmount(stroops: bigint | number | string): string {
  return stroopsToXLM(stroops);
}

/**
 * Truncates a Stellar address or contract ID for display.
 *
 * @param address - Full address (G... or C...)
 * @param prefixLen - Characters to keep at start (default: 6)
 * @param suffixLen - Characters to keep at end (default: 4)
 * @returns Truncated address with ellipsis
 *
 * @example
 * ```ts
 * truncateAddress('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ');
 * // 'GABCDE...QRST'
 * ```
 */
export function truncateAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4
): string {
  if (address.length <= prefixLen + suffixLen + 3) {
    return address;
  }
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

/**
 * Formats a timestamp in milliseconds to a human-readable UTC string.
 *
 * @param ms - Timestamp in milliseconds since epoch
 * @returns Formatted string like "2024-01-15 14:30:45 UTC"
 *
 * @example
 * ```ts
 * formatTimestamp(1705330245000); // '2024-01-15 14:30:45 UTC'
 * ```
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Formats a timestamp to a locale-aware date/time string.
 *
 * @param ms - Timestamp in milliseconds since epoch
 * @param locale - BCP 47 locale tag (default: 'en-US')
 * @param options - Intl.DateTimeFormatOptions (default: date/time medium)
 * @returns Localized date/time string
 *
 * @example
 * ```ts
 * formatDateTime(1705330245000);           // 'Jan 15, 2024, 2:30:45 PM'
 * formatDateTime(1705330245000, 'de-DE');  // '15.1.2024, 14:30:45'
 * ```
 */
export function formatDateTime(
  ms: number,
  locale = 'en-US',
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
}

/**
 * Formats a timestamp to a relative time string (e.g., "2 hours ago").
 *
 * @param ms - Timestamp in milliseconds since epoch
 * @param locale - BCP 47 locale tag (default: 'en-US')
 * @returns Relative time string
 *
 * @example
 * ```ts
 * formatRelativeTime(Date.now() - 3600000); // '1 hour ago'
 * formatRelativeTime(Date.now() + 86400000); // 'in 1 day'
 * ```
 */
export function formatRelativeTime(ms: number, locale = 'en-US'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSec = Math.round((ms - Date.now()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];

  for (const [unit, seconds] of units) {
    const value = Math.floor(Math.abs(diffSec) / seconds);
    if (value >= 1) {
      return rtf.format(diffSec < 0 ? -value : value, unit);
    }
  }
  return rtf.format(0, 'second');
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @param compact - Use compact notation (default: false)
 * @returns Formatted duration string
 *
 * @example
 * ```ts
 * formatDuration(3661000);        // '1h 1m 1s'
 * formatDuration(3661000, true);  // '1h 1m'
 * ```
 */
export function formatDuration(ms: number, compact = false): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0 && !compact) parts.push(`${seconds % 60}s`);

  if (compact && parts.length > 2) {
    return parts.slice(0, 2).join(' ');
  }
  return parts.join(' ') || '0s';
}