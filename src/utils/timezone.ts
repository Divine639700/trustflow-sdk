/**
 * Timezone handling utilities for standardized date operations.
 * Ensures consistent UTC/local time handling across the SDK.
 */

export interface TimezoneOptions {
  /** ISO timezone string (e.g., 'America/New_York') */
  timezone?: string;
}

/**
 * Converts a Date to ISO string in UTC timezone.
 * Ensures all SDK operations use consistent UTC representation.
 */
export function toUTC(date: Date): string {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  return date.toISOString();
}

/**
 * Converts a timestamp (ms) to ISO string in UTC.
 */
export function timestampToUTC(timestampMs: number): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0) {
    throw new TypeError('Expected a non-negative integer timestamp in milliseconds');
  }
  return new Date(timestampMs).toISOString();
}

/**
 * Converts an ISO string to a Date instance.
 * Validates ISO 8601 format.
 */
export function parseISO(isoString: string): Date {
  if (typeof isoString !== 'string') {
    throw new TypeError('Expected an ISO 8601 date string');
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO 8601 date string: ${isoString}`);
  }
  return date;
}

/**
 * Gets the current timestamp in milliseconds (UTC).
 */
export function getNowUTC(): number {
  return Date.now();
}

/**
 * Adds milliseconds to a date.
 */
export function addMilliseconds(date: Date, ms: number): Date {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  if (!Number.isInteger(ms)) {
    throw new TypeError('Expected an integer millisecond value');
  }
  return new Date(date.getTime() + ms);
}

/**
 * Adds seconds to a date.
 */
export function addSeconds(date: Date, seconds: number): Date {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  if (!Number.isInteger(seconds)) {
    throw new TypeError('Expected an integer second value');
  }
  return addMilliseconds(date, seconds * 1000);
}

/**
 * Adds minutes to a date.
 */
export function addMinutes(date: Date, minutes: number): Date {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  if (!Number.isInteger(minutes)) {
    throw new TypeError('Expected an integer minute value');
  }
  return addSeconds(date, minutes * 60);
}

/**
 * Adds hours to a date.
 */
export function addHours(date: Date, hours: number): Date {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  if (!Number.isInteger(hours)) {
    throw new TypeError('Expected an integer hour value');
  }
  return addMinutes(date, hours * 60);
}

/**
 * Adds days to a date.
 */
export function addDays(date: Date, days: number): Date {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  if (!Number.isInteger(days)) {
    throw new TypeError('Expected an integer day value');
  }
  return addHours(date, days * 24);
}

/**
 * Calculates the difference between two dates in milliseconds.
 */
export function diffMilliseconds(dateA: Date, dateB: Date): number {
  if (!(dateA instanceof Date) || !(dateB instanceof Date)) {
    throw new TypeError('Expected two Date instances');
  }
  return Math.abs(dateA.getTime() - dateB.getTime());
}

/**
 * Calculates the difference between two dates in seconds.
 */
export function diffSeconds(dateA: Date, dateB: Date): number {
  if (!(dateA instanceof Date) || !(dateB instanceof Date)) {
    throw new TypeError('Expected two Date instances');
  }
  return Math.floor(diffMilliseconds(dateA, dateB) / 1000);
}

/**
 * Checks if a date is in the past.
 */
export function isPast(date: Date): boolean {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  return date.getTime() < Date.now();
}

/**
 * Checks if a date is in the future.
 */
export function isFuture(date: Date): boolean {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  return date.getTime() > Date.now();
}

/**
 * Checks if a date is expired relative to a reference date.
 * Default reference is current time (UTC).
 */
export function isExpired(expirationDate: Date, referenceDate?: Date): boolean {
  if (!(expirationDate instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  return expirationDate.getTime() <= ref.getTime();
}

/**
 * Formats a date for logging (ISO format).
 */
export function formatISO(date: Date): string {
  if (!(date instanceof Date)) {
    throw new TypeError('Expected a Date instance');
  }
  return toUTC(date);
}
