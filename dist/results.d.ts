export interface ExtractedApiResult {
    readonly type: "text" | "media" | "json" | "error";
    readonly text?: string;
    readonly urls?: readonly string[];
    readonly error?: string;
    readonly value: unknown;
}
export declare function extractText(value: unknown): string | undefined;
export declare function extractMedia(value: unknown): string[];
export declare function extractApiResult(value: unknown, outputHint?: "text"): ExtractedApiResult;
