import type { MCPConfig } from "./config.js";
export type PriceCapability = "text" | "image" | "video" | "audio" | "3d" | "other";
export type PriceSort = "catalog" | "name" | "price";
export interface ModelPrice {
    readonly id: string;
    readonly provider: string;
    readonly model: string;
    readonly catalog_model: string;
    readonly alias?: string;
    readonly capability: PriceCapability;
    readonly tags: readonly string[];
    readonly pricing: {
        readonly currency: "USD";
        readonly billing_unit: string;
        readonly input?: string;
        readonly output?: string;
        readonly fixed?: string;
        readonly cache_write?: string;
        readonly cache_read?: string;
        readonly starting_price: string;
        readonly starting_price_basis: "fixed" | "input" | "output" | "cache_write" | "cache_read";
    };
    readonly max_input_tokens?: number;
    readonly context_label?: string;
    readonly updated_at?: string;
    readonly catalog_id?: number;
}
export interface PriceQuery {
    readonly model?: string;
    readonly capability?: string;
    readonly mode?: string;
    readonly search?: string;
    readonly sort?: PriceSort;
    readonly limit?: number;
    readonly language?: string;
}
export interface PriceSearchResult {
    readonly source: string;
    readonly language: string;
    readonly count: number;
    readonly models: readonly ModelPrice[];
    readonly warnings?: readonly string[];
}
export declare function queryPrices(config: Pick<MCPConfig, "timeoutMs">, query?: PriceQuery): Promise<PriceSearchResult>;
