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
export declare class MCPError extends Error {
    readonly status?: number;
    readonly details?: unknown;
    constructor(message: string, status?: number, details?: unknown);
}
export declare class ApiClient {
    private readonly config;
    constructor(config: MCPConfig);
    private body;
    request(spec: RequestSpec): Promise<ApiResponse>;
}
