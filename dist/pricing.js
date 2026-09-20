import { MCPError } from "./http.js";
const PRICE_ORIGIN = "https://gptproto.com";
const PRICE_PATH = "/api/home-model-catalog";
function text(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberText(value) {
    const result = text(value);
    return result !== undefined && Number.isFinite(Number(result)) ? result : undefined;
}
function capability(modelName, tags) {
    const values = [modelName.split("/").slice(1).join("/"), ...tags].map((value) => value.toLowerCase());
    if (values.some((value) => value.includes("-to-video") || value === "motion-control" || value === "start-end-frame"))
        return "video";
    if (values.some((value) => value.includes("-to-image") || value === "image-edit"))
        return "image";
    if (values.some((value) => value.includes("audio") || value === "voice-clone"))
        return "audio";
    if (values.some((value) => value.includes("-to-3d")))
        return "3d";
    if (values.some((value) => value.includes("-to-text") || value === "file-analysis" || value === "web-search"))
        return "text";
    return "other";
}
function normalizeCapability(value) {
    const normalized = value.trim().toLowerCase().replace(/s$/, "");
    if (["text", "image", "video", "audio", "3d", "other"].includes(normalized))
        return normalized;
    throw new MCPError("capability must be text, image, video, audio, 3d, or other");
}
function normalizeItem(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const item = value;
    const providerName = text(item.modelManufacturerName);
    const catalogModel = text(item.modelName) ?? text(item.model);
    if (!providerName || !catalogModel)
        return undefined;
    const tags = (text(item.modelTag) ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const rates = {
        input: numberText(item.platformInputPrice),
        output: numberText(item.platformOutPrice),
        fixed: numberText(item.platformLockPrice),
        cache_write: numberText(item.platformCachePrice),
        cache_read: numberText(item.platformReadCachePrice),
    };
    const starting = ["fixed", "input", "output", "cache_write", "cache_read"]
        .find((name) => rates[name] !== undefined);
    if (!starting)
        return undefined;
    const provider = providerName.toLowerCase();
    const model = catalogModel.split("/")[0];
    return {
        id: `${provider}/${model}`,
        provider,
        model,
        catalog_model: catalogModel,
        ...(text(item.alias) ? { alias: text(item.alias) } : {}),
        capability: capability(catalogModel, tags),
        tags,
        pricing: {
            currency: "USD",
            billing_unit: text(item.priceTypeStr) ?? "unspecified",
            ...(rates.input ? { input: rates.input } : {}),
            ...(rates.output ? { output: rates.output } : {}),
            ...(rates.fixed ? { fixed: rates.fixed } : {}),
            ...(rates.cache_write ? { cache_write: rates.cache_write } : {}),
            ...(rates.cache_read ? { cache_read: rates.cache_read } : {}),
            starting_price: rates[starting],
            starting_price_basis: starting,
        },
        ...(typeof item.maxInTokenNumber === "number" && item.maxInTokenNumber > 0 ? { max_input_tokens: item.maxInTokenNumber } : {}),
        ...(text(item.contextLabel) ? { context_label: text(item.contextLabel) } : {}),
        ...(text(item.createTime) ? { updated_at: text(item.createTime) } : {}),
        ...(typeof item.id === "number" ? { catalog_id: item.id } : {}),
    };
}
function catalogUrl(language) {
    const url = process.env.GPTPROTO_PRICE_CATALOG_URL?.trim()
        ? new URL(process.env.GPTPROTO_PRICE_CATALOG_URL)
        : new URL(PRICE_PATH, PRICE_ORIGIN);
    url.search = "";
    url.searchParams.set("language", language);
    return url;
}
async function fetchCatalog(config, language) {
    const url = catalogUrl(language);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
        const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
        const body = await response.json();
        if (!response.ok)
            throw new MCPError(`Price catalog request failed with HTTP ${response.status}`, response.status, body);
        if (!Array.isArray(body.data?.items))
            throw new MCPError("Price catalog response does not contain data.items");
        return body.data.items.map(normalizeItem).filter((item) => item !== undefined);
    }
    catch (error) {
        if (error instanceof MCPError)
            throw error;
        if (error instanceof DOMException && error.name === "AbortError")
            throw new MCPError(`Price catalog request timed out after ${config.timeoutMs} ms`);
        throw new MCPError(`Price catalog request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        clearTimeout(timer);
    }
}
export async function queryPrices(config, query = {}) {
    const language = query.language?.trim() || "en";
    let models = await fetchCatalog(config, language);
    if (query.model)
        models = models.filter((item) => item.id.toLowerCase() === query.model?.trim().toLowerCase());
    if (query.capability)
        models = models.filter((item) => item.capability === normalizeCapability(query.capability));
    if (query.mode?.trim()) {
        const mode = query.mode.trim().toLowerCase();
        models = models.filter((item) => item.catalog_model.split("/").slice(1).join("/").toLowerCase() === mode || item.tags.some((tag) => tag.toLowerCase() === mode));
    }
    if (query.search?.trim()) {
        const needle = query.search.trim().toLowerCase();
        models = models.filter((item) => [item.id, item.alias ?? "", item.catalog_model, ...item.tags].some((value) => value.toLowerCase().includes(needle)));
    }
    if (query.sort === "price")
        models.sort((left, right) => Number(left.pricing.starting_price) - Number(right.pricing.starting_price) || left.id.localeCompare(right.id));
    if (query.sort === "name")
        models.sort((left, right) => left.id.localeCompare(right.id));
    if (query.limit !== undefined) {
        if (!Number.isInteger(query.limit) || query.limit <= 0)
            throw new MCPError("limit must be a positive integer");
        models = models.slice(0, query.limit);
    }
    const units = new Set(models.map((item) => item.pricing.billing_unit));
    const warnings = query.sort === "price" && units.size > 1
        ? ["Prices with different billing units are not directly comparable; inspect each model's billing_unit and rate fields."]
        : undefined;
    return { source: catalogUrl(language).toString(), language, count: models.length, models, ...(warnings ? { warnings } : {}) };
}
