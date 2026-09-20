import { type MCPConfig } from "./config.js";
import { type ApiResponse, type RequestSpec } from "./http.js";
import { type PriceQuery, type PriceSearchResult } from "./pricing.js";
import { type HttpMethod, type PublicRoute } from "./routes.js";
export declare function pollIntervalForElapsed(configuredIntervalMs: number, elapsedMs: number): number;
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
export declare function taskSnapshot(body: unknown): TaskSnapshot;
export declare class GPTProtoClient {
    readonly config: MCPConfig;
    constructor(config?: MCPConfig);
    status(): Record<string, unknown>;
    private api;
    listModels(capability?: string): Promise<unknown>;
    describeModel(model: string): Promise<unknown>;
    pricing(query?: PriceQuery): Promise<PriceSearchResult>;
    describeInvocation(spec: ClientRequest): Promise<InvocationDescription | undefined>;
    request(spec: ClientRequest): Promise<ClientCallResult>;
    customCreate(resource: string, body: Record<string, unknown>): Promise<ClientCallResult>;
    customPath(resource: string): string;
    private taskPath;
    taskGet(id: string, video?: boolean, pathTemplate?: string): Promise<ClientCallResult>;
    normalizePollingPath(value: string): string;
    waitForTask(initial: unknown, options?: WaitOptions): Promise<ClientCallResult>;
    waitForCall(initial: ClientCallResult, request: ClientRequest, options?: WaitOptions): Promise<ClientCallResult>;
    taskWait(id: string, options?: WaitOptions): Promise<ClientCallResult>;
}
