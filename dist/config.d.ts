export declare const DEFAULT_API_BASE_URL = "https://gptproto.com";
export declare const API_CONTRACT_VERSION = "v0.4.0";
export interface MCPConfig {
    readonly baseUrl: string;
    readonly apiKey: string | null;
    readonly contractVersion: string;
    readonly timeoutMs: number;
    readonly pollIntervalMs: number;
    readonly maxPollMs: number;
    readonly allowFileUploads: boolean;
}
export declare function readConfig(): MCPConfig;
