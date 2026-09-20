import { readConfig, type MCPConfig } from "./config.js";
import { ApiClient, MCPError, type ApiResponse, type RequestSpec } from "./http.js";
import { queryPrices, type PriceQuery, type PriceSearchResult } from "./pricing.js";
import {
  findPublicRoute,
  matchesPathTemplate,
  type HttpMethod,
  type PublicRoute,
} from "./routes.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "expired", "succeeded", "success"]);

export function pollIntervalForElapsed(configuredIntervalMs: number, elapsedMs: number): number {
  if (elapsedMs < 60_000) return Math.min(configuredIntervalMs, 10_000);
  if (elapsedMs < 180_000) return Math.min(configuredIntervalMs, 8_000);
  return Math.min(configuredIntervalMs, 5_000);
}

const CUSTOM_PATHS: Readonly<Record<string, string>> = {
  video: "/api/v3/videos",
  image: "/api/v3/images",
  speech: "/api/v3/audio/speech",
  "voice-clone": "/api/v3/audio/voice-clone",
  "lip-sync": "/api/v3/lip-sync",
  "3d": "/api/v3/3d",
  "image-edit": "/api/v3/images/edit",
};

export interface ClientCallResult {
  readonly response: ApiResponse;
  readonly route: PublicRoute;
}

export interface ClientRequest extends RequestSpec {
  readonly method: HttpMethod;
  readonly allowReview?: boolean;
}

export interface WaitOptions {
  readonly video?: boolean;
  readonly resource?: string;
  readonly pollingPath?: string;
  readonly pollingModel?: string;
  readonly intervalMs?: number;
  readonly timeoutSeconds?: number;
  readonly resultRoute?: PublicRoute;
  readonly onUpdate?: (result: ClientCallResult) => void | Promise<void>;
}

export interface InvocationDescription {
  readonly async: boolean;
  readonly pollingPath?: string;
}

export interface TaskSnapshot {
  readonly id?: string;
  readonly status?: string;
  readonly pollingUrl?: string;
}

function removeProvider(value: string): string {
  const slash = value.indexOf("/");
  return slash > 0 && slash < value.length - 1 ? value.slice(slash + 1) : value;
}

function normalizeBody(route: PublicRoute, body: unknown): unknown {
  if (route.family === "GPTProto custom" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  return typeof record.model === "string" ? { ...record, model: removeProvider(record.model) } : body;
}

function normalizeForm(route: PublicRoute, form: readonly [string, string][] | undefined): [string, string][] | undefined {
  if (!form) return undefined;
  return form.map(([name, value]) => route.family !== "GPTProto custom" && name === "model"
    ? [name, removeProvider(value)]
    : [name, value]);
}

function nestedString(body: unknown, names: readonly string[]): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const name of names) if (typeof record[name] === "string" && record[name]) return record[name] as string;
  for (const name of ["data", "task", "result", "response"]) {
    const result = nestedString(record[name], names);
    if (result) return result;
  }
  return undefined;
}

function taskId(body: unknown): string | undefined {
  const direct = nestedString(body, ["id", "task_id", "video_id", "operation_id"]);
  if (direct) return direct;
  const name = nestedString(body, ["name"]);
  return name?.split("/").filter(Boolean).pop();
}

function taskStatus(body: unknown): string | undefined {
  return nestedString(body, ["status", "state"])?.toLowerCase();
}

function pollingUrl(body: unknown): string | undefined {
  return nestedString(body, ["polling_url"]);
}

export function taskSnapshot(body: unknown): TaskSnapshot {
  const id = taskId(body);
  const status = taskStatus(body);
  const returnedPollingUrl = pollingUrl(body);
  return {
    ...(id ? { id } : {}),
    ...(status ? { status } : {}),
    ...(returnedPollingUrl ? { pollingUrl: returnedPollingUrl } : {}),
  };
}

function requestModel(spec: Pick<ClientRequest, "body" | "form">): string | undefined {
  if (spec.body && typeof spec.body === "object" && !Array.isArray(spec.body)) {
    const model = (spec.body as Record<string, unknown>).model;
    if (typeof model === "string" && model.includes("/")) return model;
  }
  const formModel = spec.form?.find(([name]) => name === "model")?.[1];
  return formModel?.includes("/") ? formModel : undefined;
}

function fillPollingPath(template: string, id: string, body: unknown, modelHint?: string): string {
  let result = template.replace(/\{(?:id|task_id|taskId|video_id|operation_id)\}/g, encodeURIComponent(id));
  const operationName = nestedString(body, ["name"]);
  const model = nestedString(body, ["model"])
    ?? operationName?.match(/(?:^|\/)models\/([^/]+)/)?.[1]
    ?? modelHint;
  if (model) result = result.replace(/\{model\}/g, encodeURIComponent(removeProvider(model)));
  if (/\{[^}]+\}/.test(result)) throw new MCPError(`Polling path has unresolved parameters: ${result}`);
  return result;
}

export class GPTProtoClient {
  readonly config: MCPConfig;

  constructor(config: MCPConfig = readConfig()) {
    this.config = config;
  }

  status(): Record<string, unknown> {
    return {
      api_key_configured: Boolean(this.config.apiKey),
      using_default_api_origin: this.config.baseUrl === "https://gptproto.com",
      file_uploads_enabled: this.config.allowFileUploads,
      contract_version: this.config.contractVersion,
      timeout_ms: this.config.timeoutMs,
      poll_interval_ms: this.config.pollIntervalMs,
      max_poll_ms: this.config.maxPollMs,
    };
  }

  private api(): ApiClient {
    return new ApiClient(this.config);
  }

  async listModels(capability?: string): Promise<unknown> {
    const path = capability ? `/v1/cli/models?capability=${encodeURIComponent(capability)}` : "/v1/cli/models";
    return (await this.api().request({ method: "GET", path })).body;
  }

  async describeModel(model: string): Promise<unknown> {
    const [provider, ...parts] = model.split("/");
    if (!provider || parts.length === 0) throw new MCPError("model must use provider/model");
    return (await this.api().request({
      method: "GET",
      path: `/v1/cli/models/${encodeURIComponent(provider)}/${encodeURIComponent(parts.join("/"))}`,
    })).body;
  }

  async pricing(query: PriceQuery = {}): Promise<PriceSearchResult> {
    return queryPrices(this.config, query);
  }

  async describeInvocation(spec: ClientRequest): Promise<InvocationDescription | undefined> {
    const model = requestModel(spec);
    if (!model) return undefined;
    const description = await this.describeModel(model);
    if (!description || typeof description !== "object") return undefined;
    const interfaces = (description as Record<string, unknown>).interfaces;
    if (!Array.isArray(interfaces)) return undefined;
    for (const item of interfaces) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (String(entry.method ?? "").toUpperCase() !== spec.method.toUpperCase()) continue;
      if (typeof entry.path !== "string" || !matchesPathTemplate(entry.path, spec.path)) continue;
      return {
        async: entry.async === true,
        ...(typeof entry.poll_path === "string" ? { pollingPath: entry.poll_path } : {}),
      };
    }
    return undefined;
  }

  async request(spec: ClientRequest): Promise<ClientCallResult> {
    const route = findPublicRoute(spec.method, spec.path);
    if (!route) throw new MCPError(`Unlisted public route: ${spec.method} ${spec.path.split("?", 1)[0]}`);
    if (route.requiresReview && !spec.allowReview) {
      throw new MCPError(`${spec.method} ${spec.path.split("?", 1)[0]} requires explicit contract review`);
    }
    if ((spec.files?.length ?? 0) > 0 && !this.config.allowFileUploads) {
      throw new MCPError(
        "Local file uploads are disabled; the user must explicitly enable GPTPROTO_MCP_ALLOW_FILE_UPLOADS=true",
      );
    }
    const response = await this.api().request({
      method: spec.method,
      path: spec.path,
      body: normalizeBody(route, spec.body),
      form: normalizeForm(route, spec.form),
      files: spec.files,
      headers: spec.headers,
      query: spec.query,
    });
    return { response, route };
  }

  async customCreate(resource: string, body: Record<string, unknown>): Promise<ClientCallResult> {
    return this.request({ method: "POST", path: this.customPath(resource), body });
  }

  customPath(resource: string): string {
    const path = CUSTOM_PATHS[resource.toLowerCase()];
    if (!path) throw new MCPError(`Unknown custom resource: ${resource}`);
    return path;
  }

  private taskPath(id: string, video = false, pathTemplate?: string): string {
    if (!pathTemplate) {
      return video
        ? `/api/v3/videos/${encodeURIComponent(id)}`
        : `/api/v3/tasks/result/${encodeURIComponent(id)}`;
    }
    const path = pathTemplate.replace(/\{(?:id|task_id|taskId|video_id|operation_id)\}/g, encodeURIComponent(id));
    if (/\{[^}]+\}/.test(path)) throw new MCPError(`Task path has unresolved parameters: ${path}`);
    return path;
  }

  async taskGet(id: string, video = false, pathTemplate?: string): Promise<ClientCallResult> {
    return this.request({
      method: "GET",
      path: this.taskPath(id, video, pathTemplate),
    });
  }

  normalizePollingPath(value: string): string {
    const base = new URL(this.config.baseUrl);
    const target = new URL(value, base);
    if (target.origin !== base.origin) throw new MCPError("The API returned a polling URL outside GPTPROTO_API_BASE_URL");
    return `${target.pathname}${target.search}`;
  }

  async waitForTask(initial: unknown, options: WaitOptions = {}): Promise<ClientCallResult> {
    const id = taskId(initial);
    if (!id) throw new MCPError("The response does not contain a task id");
    const returnedPollingUrl = pollingUrl(initial);
    let path = returnedPollingUrl
      ? this.normalizePollingPath(returnedPollingUrl)
      : options.pollingPath
        ? fillPollingPath(options.pollingPath, id, initial, options.pollingModel)
        : options.video || options.resource === "video"
          ? `/api/v3/videos/${encodeURIComponent(id)}`
          : `/api/v3/tasks/result/${encodeURIComponent(id)}`;
    const initialStatus = taskStatus(initial);
    if (initialStatus && TERMINAL_STATUSES.has(initialStatus)) {
      const route = findPublicRoute("GET", path) ?? findPublicRoute("GET", "/api/v3/tasks/result/result");
      if (!route) throw new MCPError(`No public polling route matches ${path}`);
      const result = {
        response: {
          status: 200,
          contentType: "application/json",
          headers: {},
          body: initial,
          raw: Buffer.from(JSON.stringify(initial)),
        },
        route: options.resultRoute ?? route,
      };
      await options.onUpdate?.(result);
      return result;
    }
    const timeoutSeconds = options.timeoutSeconds ?? this.config.maxPollMs / 1000;
    if ((options.intervalMs ?? this.config.pollIntervalMs) <= 0 || timeoutSeconds <= 0) {
      throw new MCPError("Polling interval and timeout must be positive");
    }
    const startedAt = Date.now();
    const deadline = startedAt + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const now = Date.now();
      const intervalMs = options.intervalMs
        ?? pollIntervalForElapsed(this.config.pollIntervalMs, now - startedAt);
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, deadline - now)));
      if (Date.now() >= deadline) break;
      const result = await this.request({ method: "GET", path });
      await options.onUpdate?.(options.resultRoute ? { ...result, route: options.resultRoute } : result);
      const status = taskStatus(result.response.body);
      if (status && TERMINAL_STATUSES.has(status)) {
        return options.resultRoute ? { ...result, route: options.resultRoute } : result;
      }
      const next = pollingUrl(result.response.body);
      if (next) path = this.normalizePollingPath(next);
    }
    throw new MCPError(`Task ${id} did not reach a terminal state within ${timeoutSeconds} seconds`);
  }

  async waitForCall(
    initial: ClientCallResult,
    request: ClientRequest,
    options: WaitOptions = {},
  ): Promise<ClientCallResult> {
    const returnedPollingUrl = pollingUrl(initial.response.body);
    const described = !returnedPollingUrl && !options.pollingPath
      ? await this.describeInvocation(request)
      : undefined;
    if (!returnedPollingUrl && described && !described.async) {
      throw new MCPError(`${request.method} ${request.path} is not an asynchronous operation`);
    }
    const pollingPath = options.pollingPath ?? described?.pollingPath ?? initial.route.pollPath;
    if (!returnedPollingUrl && !pollingPath && initial.route.async !== true) {
      throw new MCPError(`${request.method} ${request.path} is not an asynchronous operation`);
    }
    return this.waitForTask(initial.response.body, {
      ...options,
      pollingPath,
      pollingModel: requestModel(request),
      resultRoute: initial.route,
    });
  }

  async taskWait(id: string, options: WaitOptions = {}): Promise<ClientCallResult> {
    const path = this.taskPath(id, Boolean(options.video), options.pollingPath);
    const result = await this.request({ method: "GET", path });
    return this.waitForTask(result.response.body, {
      ...options,
      pollingPath: path,
      resultRoute: result.route,
    });
  }
}
