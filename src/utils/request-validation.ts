/**
 * Request body size validation utilities.
 * Validates request payloads client-side before sending to backend.
 */

import { TrustFlowError } from '../errors';

export interface RequestValidationConfig {
  /** Maximum allowed request body size in bytes. Defaults to 10MB. */
  maxRequestSizeBytes?: number;
  /** Maximum allowed JSON string length before serialization. */
  maxJsonLength?: number;
}

export const DEFAULT_MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
export const DEFAULT_MAX_JSON_LENGTH = 5 * 1024 * 1024; // 5MB

/**
 * Calculates the byte size of a JSON-serializable value.
 * Uses UTF-8 encoding for accurate measurement.
 */
export function getJsonSizeBytes(obj: unknown): number {
  try {
    const json = JSON.stringify(obj);
    return new Blob([json]).size;
  } catch (error) {
    throw new TrustFlowError(
      'Failed to calculate request size: non-serializable object',
      'VALIDATION_ERROR',
      error,
    );
  }
}

/**
 * Validates that a request body doesn't exceed size limits.
 * @param body - The request body object
 * @param config - Validation configuration
 * @throws {TrustFlowError} If request exceeds size limits
 */
export function validateRequestSize(body: unknown, config?: RequestValidationConfig): void {
  const maxSize = config?.maxRequestSizeBytes ?? DEFAULT_MAX_REQUEST_SIZE;

  const sizeBytes = getJsonSizeBytes(body);

  if (sizeBytes > maxSize) {
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
    const maxMB = (maxSize / (1024 * 1024)).toFixed(2);
    throw new TrustFlowError(
      `Request body size (${sizeMB}MB) exceeds maximum allowed size (${maxMB}MB)`,
      'VALIDATION_ERROR',
    );
  }
}

/**
 * Checks if an object would exceed size limits.
 * Returns true if size is within limits, false otherwise.
 */
export function isRequestSizeValid(body: unknown, config?: RequestValidationConfig): boolean {
  try {
    validateRequestSize(body, config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets a human-readable size string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Validates request headers for size limits.
 * Individual headers should not be excessively large.
 */
export function validateHeaderSize(
  headers: Record<string, string>,
  maxHeaderSizeBytes = 8192,
): void {
  for (const [key, value] of Object.entries(headers)) {
    const headerSize = new Blob([`${key}: ${value}`]).size;
    if (headerSize > maxHeaderSizeBytes) {
      throw new TrustFlowError(
        `Header "${key}" size (${formatBytes(headerSize)}) exceeds maximum allowed size`,
        'VALIDATION_ERROR',
      );
    }
  }
}

/**
 * Validates query parameters for reasonable size.
 */
export function validateQueryParamSize(params: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(params)) {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const paramSize = new Blob([`${key}=${stringValue}`]).size;

    if (paramSize > 2048) {
      throw new TrustFlowError(
        `Query parameter "${key}" is too large (${formatBytes(paramSize)})`,
        'VALIDATION_ERROR',
      );
    }
  }
}

/**
 * Safely truncates a request body if it exceeds limits.
 * Used as a fallback when validation fails.
 * WARNING: This may lose data. Use only when necessary.
 */
export function truncateRequestBody<T extends Record<string, any>>(
  body: T,
  maxSize: number = DEFAULT_MAX_REQUEST_SIZE,
): T {
  let size = getJsonSizeBytes(body);

  if (size <= maxSize) {
    return body;
  }

  // Widened before mutation: `T` is only readable, so writing through it is a
  // type error even though `truncated` is a fresh object we own.
  const truncated: Record<string, any> = { ...body };

  for (const key of Object.keys(truncated)) {
    const value = truncated[key];
    if (typeof value === 'string' && value.length > 1000) {
      truncated[key] = value.slice(0, 1000) + '...[truncated]';
      size = getJsonSizeBytes(truncated);

      if (size <= maxSize) {
        return truncated as T;
      }
    }
  }

  return truncated as T;
}
