import { readFile } from "node:fs/promises";
import type { MCPConfig } from "./config.js";

export interface FormFile {
  readonly field: string;
  readonly path: string;
  readonly contentType?: string;
}

export interface RequestSpec {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly form?: readonly [string, string][];
  readonly files?: readonly FormFile[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: readonly [string, string][];
}

export interface ApiResponse {
  readonly status: number;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly raw: Buffer;
}

export class MCPError extends Error {
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "MCPError";
    this.status = status;
    this.details = details;
  }
}

function requestUrl(baseUrl: string, path: string, query?: readonly [string, string][]): string {
  if (!path.startsWith("/") || /^https?:\/\//i.test(path)) {
    throw new MCPError("API path must be relative and start with /");
  }
  const base = new URL(baseUrl);
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${pathname}` || "/";
  base.search = queryAt === -1 ? "" : path.slice(queryAt + 1);
  for (const [name, value] of query ?? []) base.searchParams.append(name, value);
  return base.toString();
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const message = (record.error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return `GPTProto request failed with HTTP ${status}`;
}

function responseHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, key) => { result[key] = value; });
  return result;
}

function textFromUnknown(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) return record.content.map(textFromUnknown).join("");
  if (record.content && typeof record.content === "object") {
    const nested = textFromUnknown(record.content);
    if (nested) return nested;
  }
  if (Array.isArray(record.parts)) return record.parts.map(textFromUnknown).join("");
  return "";
}

function extractEventStreamText(value: string): string | undefined {
  const skipped = new Set([
    "message_start", "message_stop", "message_delta", "content_block_start",
    "content_block_stop", "ping", "response.created", "response.in_progress",
    "response.completed", "response.output_item.added", "response.output_item.done",
    "response.content_part.added", "response.content_part.done",
  ]);
  let result = "";
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trimStart();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const eventType = typeof payload.type === "string" ? payload.type : "";
      if (eventType.endsWith(".done") || skipped.has(eventType)) continue;
      if (payload.delta !== undefined) result += textFromUnknown(payload.delta);
      if (typeof payload.output_text === "string") result += payload.output_text;
      if (Array.isArray(payload.choices)) {
        for (const choice of payload.choices) {
          if (!choice || typeof choice !== "object") continue;
          const item = choice as Record<string, unknown>;
          result += textFromUnknown(item.delta ?? item.message ?? item);
        }
      }
      if (Array.isArray(payload.candidates)) {
        for (const candidate of payload.candidates) result += textFromUnknown(candidate);
      }
      if (Array.isArray(payload.content)) result += textFromUnknown({ content: payload.content });
    } catch {
      // Ignore non-JSON SSE metadata, matching the CLI's extracted stream mode.
    }
  }
  return result || undefined;
}

async function decode(response: Response): Promise<{ body: unknown; raw: Buffer; contentType: string }> {
  const raw = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  if (!raw.length) return { body: null, raw, contentType };
  const text = raw.toString("utf8");
  if (contentType.includes("text/event-stream")) {
    return { body: extractEventStreamText(text) ?? text, raw, contentType };
  }
  if (contentType.includes("json") || /^[\s]*[\[{]/.test(text)) {
    try { return { body: JSON.parse(text) as unknown, raw, contentType }; } catch { /* return text */ }
  }
  return contentType.startsWith("text/") ? { body: text, raw, contentType } : { body: raw, raw, contentType };
}

export class ApiClient {
  constructor(private readonly config: MCPConfig) {}

  private async body(spec: RequestSpec, headers: Headers): Promise<string | FormData | undefined> {
    if ((spec.form?.length ?? 0) > 0 || (spec.files?.length ?? 0) > 0) {
      if (spec.body !== undefined) throw new MCPError("JSON body cannot be combined with multipart fields");
      const formData = new FormData();
      for (const [name, value] of spec.form ?? []) formData.append(name, value);
      for (const file of spec.files ?? []) {
        const bytes = await readFile(file.path);
        formData.append(
          file.field,
          new Blob([bytes], { type: file.contentType ?? "application/octet-stream" }),
          file.path.split(/[\\/]/).pop() ?? "upload",
        );
      }
      return formData;
    }
    if (spec.body === undefined) return undefined;
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
  }

  async request(spec: RequestSpec): Promise<ApiResponse> {
    if (!this.config.apiKey) throw new MCPError("GPTProto API key is not configured");
    const url = requestUrl(this.config.baseUrl, spec.path, spec.query);
    const headers = new Headers({
      authorization: `Bearer ${this.config.apiKey}`,
      accept: "application/json, text/plain, */*",
    });
    for (const [name, value] of Object.entries(spec.headers ?? {})) {
      if (name.toLowerCase() === "authorization") {
        throw new MCPError("The Authorization header is managed by GPTPROTO_API_KEY");
      }
      headers.set(name, value);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: spec.method.toUpperCase(),
        headers,
        body: await this.body(spec, headers),
        signal: controller.signal,
      });
      const decoded = await decode(response);
      if (!response.ok) throw new MCPError(errorMessage(response.status, decoded.body), response.status, decoded.body);
      return {
        status: response.status,
        contentType: decoded.contentType,
        headers: responseHeaders(response),
        body: decoded.body,
        raw: decoded.raw,
      };
    } catch (error) {
      if (error instanceof MCPError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MCPError(`GPTProto request timed out after ${this.config.timeoutMs} ms`);
      }
      throw new MCPError(`GPTProto request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
