function textParts(value) {
    if (typeof value === "string")
        return value ? [value] : [];
    if (!Array.isArray(value))
        return [];
    const parts = [];
    for (const item of value) {
        if (typeof item === "string") {
            if (item)
                parts.push(item);
            continue;
        }
        if (!item || typeof item !== "object")
            continue;
        const record = item;
        if (typeof record.text === "string" && record.text)
            parts.push(record.text);
        else if (typeof record.output_text === "string" && record.output_text)
            parts.push(record.output_text);
    }
    return parts;
}
export function extractText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return undefined;
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                return extractText(JSON.parse(trimmed));
            }
            catch {
                return value;
            }
        }
        return value;
    }
    if (!value || typeof value !== "object")
        return undefined;
    const body = value;
    if (typeof body.output_text === "string" && body.output_text)
        return body.output_text;
    if (Array.isArray(body.output_text)) {
        const parts = textParts(body.output_text);
        if (parts.length)
            return parts.join("");
    }
    if (Array.isArray(body.output)) {
        const parts = [];
        for (const item of body.output) {
            if (!item || typeof item !== "object")
                continue;
            const record = item;
            parts.push(...textParts(record.content));
            if (typeof record.text === "string")
                parts.push(record.text);
        }
        if (parts.length)
            return parts.join("");
    }
    if (Array.isArray(body.content)) {
        const parts = textParts(body.content);
        if (parts.length)
            return parts.join("");
    }
    if (Array.isArray(body.choices)) {
        const parts = [];
        for (const choice of body.choices) {
            if (!choice || typeof choice !== "object")
                continue;
            const record = choice;
            if (typeof record.text === "string")
                parts.push(record.text);
            const message = record.message ?? record.delta;
            if (message && typeof message === "object")
                parts.push(...textParts(message.content));
        }
        if (parts.length)
            return parts.join("");
    }
    if (Array.isArray(body.candidates)) {
        const parts = [];
        for (const candidate of body.candidates) {
            if (!candidate || typeof candidate !== "object")
                continue;
            const record = candidate;
            if (typeof record.text === "string")
                parts.push(record.text);
            const content = record.content;
            if (content && typeof content === "object") {
                const contentRecord = content;
                parts.push(...textParts(contentRecord.parts));
                if (typeof contentRecord.text === "string")
                    parts.push(contentRecord.text);
            }
        }
        if (parts.length)
            return parts.join("");
    }
    if (body.message && typeof body.message === "object") {
        const parts = textParts(body.message.content);
        if (parts.length)
            return parts.join("");
    }
    if (body.data && typeof body.data === "object") {
        const nested = extractText(body.data);
        if (nested)
            return nested;
    }
    return typeof body.text === "string" ? body.text : undefined;
}
function extractError(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const body = value;
    if (typeof body.error === "string")
        return body.error;
    if (body.error && typeof body.error === "object") {
        const message = body.error.message;
        if (typeof message === "string")
            return message;
    }
    if (typeof body.message === "string" && /fail|error/i.test(String(body.status ?? "")))
        return body.message;
    return undefined;
}
export function extractMedia(value) {
    const urls = [];
    const visit = (node, key = "") => {
        if (typeof node === "string") {
            if (key !== "polling_url" && /^(unsigned_urls|outputs|output|url|uri|image_url|video_url|audio_url|result)$/i.test(key) && /^https?:\/\//.test(node))
                urls.push(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item, key);
            return;
        }
        if (!node || typeof node !== "object")
            return;
        for (const [name, child] of Object.entries(node))
            visit(child, name);
    };
    visit(value);
    return [...new Set(urls)];
}
export function extractApiResult(value, outputHint) {
    const error = extractError(value);
    if (error)
        return { type: "error", error, value };
    if (outputHint === "text") {
        const text = extractText(value);
        if (text !== undefined)
            return { type: "text", text, value };
    }
    const urls = extractMedia(value);
    if (urls.length)
        return { type: "media", urls, value };
    return { type: "json", value };
}
