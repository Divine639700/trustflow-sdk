import { isValidCid } from './cid';
import { logger } from '../utils/logger';
import type { SDKResult } from '../types/index';
import type { AxiosInstance } from 'axios';
import { createApiHttpClient, toApiErrorMessage } from '../utils/http';
import type { ApiRetryConfig } from '../utils/http';
import type { HttpInterceptors } from '../utils/interceptors';
import { logger } from '../utils/logger';

/** Default upload endpoint — a raw-body IPFS upload API (e.g. web3.storage-compatible). */
const DEFAULT_IPFS_API_URL = 'https://api.web3.storage/upload';
/** Default read gateway used to build a browsable URL from a returned CID. */
const DEFAULT_IPFS_GATEWAY = 'https://w3s.link/ipfs';

export interface IPFSConfig {
  /** Upload endpoint. Defaults to a web3.storage-compatible raw-body upload API. */
  apiUrl?: string;
  /** Bearer token / API key for the upload service. */
  apiKey?: string;
  /** Read gateway used to build the returned `url` from a CID. */
  gatewayUrl?: string;
  /** Request timeout in milliseconds. Defaults to 10s. */
  timeoutMs?: number;
  /**
   * Retry budget for upload requests. Defaults to 3 retries with a 250ms base
   * delay and a 2s cap.
   *
   * `upload` is a `POST`, so a `429`/`5xx` or transport error is **not** retried
   * by default: the upload service may have stored the file before the response
   * was lost, and a replay would create a second, unreachable object. Set
   * `{ trustflowRetry: true }` on the call when the service de-duplicates by
   * content and replaying is safe.
   */
  retry?: ApiRetryConfig;
  /** Request/response interceptor hooks applied to upload calls. */
  interceptors?: HttpInterceptors;
}

export interface IPFSUploadOptions {
  /** Original filename, forwarded to the upload service when supported. */
  filename?: string;
  /** MIME type of the file. Defaults to `application/octet-stream`. */
  contentType?: string;
}

export interface IPFSUploadResult {
  /** Content identifier of the uploaded file. */
  cid: string;
  /** Gateway URL the uploaded file can be fetched from. */
  url: string;
}

/**
 * Minimal IPFS upload helper — `trustflow.storage.upload(file)`.
 *
 * Uploads a file as a raw request body (no multipart/form-data encoding),
 * which is compatible with web3.storage-style upload APIs. Point `apiUrl`
 * at any service that accepts a raw file body and returns `{ cid }`.
 *
 * @example
 * ```typescript
 * const storage = new IPFSStorage({ apiKey: process.env.IPFS_API_KEY });
 * const result = await storage.upload(fileBuffer, { filename: 'contract.pdf' });
 * if (result.ok) console.log('Uploaded:', result.data.url);
 * ```
 */
export class IPFSStorage {
  private readonly gatewayUrl: string;
  private readonly http: AxiosInstance;

  constructor(config: IPFSConfig = {}) {
    this.gatewayUrl = config.gatewayUrl ?? DEFAULT_IPFS_GATEWAY;
    this.http = createApiHttpClient({
      baseURL: config.apiUrl ?? DEFAULT_IPFS_API_URL,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      interceptors: config.interceptors,
    });
  }

  /**
   * Uploads a file to IPFS.
   *
   * **Retry behaviour:** a `POST`, so `429`/`5xx` and transport errors are
   * surfaced rather than replayed — a retried upload may leave an orphaned
   * object and burn quota twice. Configure `IPFSConfig.retry` to tune the
   * budget, and set `{ trustflowRetry: true }` on the call when your upload
   * service de-duplicates by content hash.
   *
   * @param file - File contents as a `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob` or `File`.
   *   For a `File`, its `name` is used as the default `filename`; for a `Blob` or `File`, its
   *   `type` is used as the default `contentType`.
   * @param options - Optional filename / content type metadata
   * @returns `{ ok: true, data: { cid, url } }` on success, `{ ok: false, error }` on failure
   */
  async upload(
    file: Buffer | Uint8Array | ArrayBuffer | Blob,
    options: IPFSUploadOptions = {},
  ): Promise<SDKResult<IPFSUploadResult>> {
    const isBlob = typeof Blob !== 'undefined' && file instanceof Blob;
    const size = isBlob
      ? (file as Blob).size
      : (file as Buffer | Uint8Array | ArrayBuffer)?.byteLength;
    if (!file || !size) {
      return {
        ok: false,
        error: 'file must be a non-empty Buffer, Uint8Array, ArrayBuffer, Blob or File',
      };
    }

    const filename = options.filename ?? (isBlob ? (file as File).name : undefined);
    const contentType =
      options.contentType || (isBlob ? (file as Blob).type : '') || 'application/octet-stream';

    logger.debug('Uploading file to IPFS', { size, filename, contentType });
    try {
      const body = isBlob
        ? new Uint8Array(await (file as Blob).arrayBuffer())
        : file instanceof ArrayBuffer
          ? new Uint8Array(file)
          : file;
      // An empty url posts to the configured apiUrl as-is (no appended slash, query string kept).
      const response = await this.http.post<{ cid?: string }>('', body, {
        headers: {
          'Content-Type': contentType,
          ...(filename ? { 'X-Name': filename } : {}),
        },
      });
      const cid = response.data?.cid;
      if (!cid || !isValidCid(cid)) {
        logger.warn('IPFS upload returned invalid or missing CID', { cid });
        return { ok: false, error: 'Upload succeeded but response did not include a valid CID' };
      }
      logger.info('IPFS upload succeeded', { cid });
      return { ok: true, data: { cid, url: `${this.gatewayUrl}/${cid}` } };
    } catch (err) {
      logger.error('IPFS upload failed', { error: toApiErrorMessage(err) });
      return { ok: false, error: toApiErrorMessage(err) };
    }
  }
}
