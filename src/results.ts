export interface ExtractedApiResult {
  readonly type: "text" | "media" | "json" | "error";
  readonly text?: string;
  readonly urls?: readonly string[];
  readonly error?: string;
  readonly value: unknown;
}

function textParts(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item) parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === "string" && record.text) parts.push(record.text);
    else if (typeof record.output_text === "string" && record.output_text) parts.push(record.output_text);
  }
  return parts;
}

export function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return extractText(JSON.parse(trimmed) as unknown); } catch { return value; }
    }
    return value;
  }
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.output_text === "string" && body.output_text) return body.output_text;
  if (Array.isArray(body.output_text)) {
    const parts = textParts(body.output_text);
    if (parts.length) return parts.join("");
  }
  if (Array.isArray(body.output)) {
    const parts: string[] = [];
    for (const item of body.output) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      parts.push(...textParts(record.content));
      if (typeof record.text === "string") parts.push(record.text);
    }
    if (parts.length) return parts.join("");
  }
  if (Array.isArray(body.content)) {
    const parts = textParts(body.content);
    if (parts.length) return parts.join("");
  }
  if (Array.isArray(body.choices)) {
    const parts: string[] = [];
    for (const choice of body.choices) {
      if (!choice || typeof choice !== "object") continue;
      const record = choice as Record<string, unknown>;
      if (typeof record.text === "string") parts.push(record.text);
      const message = record.message ?? record.delta;
      if (message && typeof message === "object") parts.push(...textParts((message as Record<string, unknown>).content));
    }
    if (parts.length) return parts.join("");
  }
  if (Array.isArray(body.candidates)) {
    const parts: string[] = [];
    for (const candidate of body.candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const record = candidate as Record<string, unknown>;
      if (typeof record.text === "string") parts.push(record.text);
      const content = record.content;
      if (content && typeof content === "object") {
        const contentRecord = content as Record<string, unknown>;
        parts.push(...textParts(contentRecord.parts));
        if (typeof contentRecord.text === "string") parts.push(contentRecord.text);
      }
    }
    if (parts.length) return parts.join("");
  }
  if (body.message && typeof body.message === "object") {
    const parts = textParts((body.message as Record<string, unknown>).content);
    if (parts.length) return parts.join("");
  }
  if (body.data && typeof body.data === "object") {
    const nested = extractText(body.data);
    if (nested) return nested;
  }
  return typeof body.text === "string" ? body.text : undefined;
}

function extractError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object") {
    const message = (body.error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof body.message === "string" && /fail|error/i.test(String(body.status ?? ""))) return body.message;
  return undefined;
}

export function extractMedia(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (node: unknown, key = ""): void => {
    if (typeof node === "string") {
      if (key !== "polling_url" && /^(unsigned_urls|outputs|output|url|uri|image_url|video_url|audio_url|result)$/i.test(key) && /^https?:\/\//.test(node)) urls.push(node);
      return;
    }
    if (Array.isArray(node)) { for (const item of node) visit(item, key); return; }
    if (!node || typeof node !== "object") return;
    for (const [name, child] of Object.entries(node as Record<string, unknown>)) visit(child, name);
  };
  visit(value);
  return [...new Set(urls)];
}

export function extractApiResult(value: unknown, outputHint?: "text"): ExtractedApiResult {
  const error = extractError(value);
  if (error) return { type: "error", error, value };
  if (outputHint === "text") {
    const text = extractText(value);
    if (text !== undefined) return { type: "text", text, value };
  }
  const urls = extractMedia(value);
  if (urls.length) return { type: "media", urls, value };
  return { type: "json", value };
}
