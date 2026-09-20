import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API_BASE_URL = "https://gptproto.com";
export const API_CONTRACT_VERSION = "v0.4.0";

const KEY_FILE = join(homedir(), ".config", "gptproto-mcp", "key");
const URL_FILE = join(homedir(), ".config", "gptproto-mcp", "base-url");
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLL_MS = 10 * 60_000;

export interface MCPConfig {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly contractVersion: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly maxPollMs: number;
  readonly allowFileUploads: boolean;
}

function stored(path: string): string | undefined {
  try { return readFileSync(path, "utf8").trim() || undefined; } catch { return undefined; }
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function normalizedKey(value: string | undefined): string | null {
  return value?.trim().replace(/^Bearer\s+/i, "") || null;
}

function booleanFlag(name: string, value: string | undefined): boolean {
  if (!value) return false;
  if (/^(?:1|true|yes)$/i.test(value)) return true;
  if (/^(?:0|false|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function validateBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("GPTPROTO_API_BASE_URL must use http or https");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("GPTPROTO_API_BASE_URL must not contain credentials, query parameters, or a fragment");
  }
  return normalized;
}

export function readConfig(): MCPConfig {
  const baseUrl = validateBaseUrl(
    process.env.GPTPROTO_API_BASE_URL?.trim() || stored(URL_FILE) || DEFAULT_API_BASE_URL,
  );
  const apiKey = normalizedKey(process.env.GPTPROTO_API_KEY) || normalizedKey(stored(KEY_FILE));
  const requestedContract = process.env.GPTPROTO_API_DOC_VERSION?.trim() || API_CONTRACT_VERSION;
  const normalizedContract = requestedContract.startsWith("v") ? requestedContract : `v${requestedContract}`;
  if (normalizedContract !== API_CONTRACT_VERSION) {
    throw new Error(`Unsupported API document version ${normalizedContract}; this MCP supports ${API_CONTRACT_VERSION}`);
  }
  return {
    baseUrl,
    apiKey,
    contractVersion: API_CONTRACT_VERSION,
    timeoutMs: positiveInteger("GPTPROTO_TIMEOUT_MS", process.env.GPTPROTO_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: positiveInteger("GPTPROTO_POLL_INTERVAL_MS", process.env.GPTPROTO_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    maxPollMs: positiveInteger(
      "GPTPROTO_MAX_POLL_SECONDS",
      process.env.GPTPROTO_MAX_POLL_SECONDS
        ? `${Number(process.env.GPTPROTO_MAX_POLL_SECONDS) * 1000}`
        : undefined,
      DEFAULT_MAX_POLL_MS,
    ),
    allowFileUploads: booleanFlag(
      "GPTPROTO_MCP_ALLOW_FILE_UPLOADS",
      process.env.GPTPROTO_MCP_ALLOW_FILE_UPLOADS,
    ),
  };
}
