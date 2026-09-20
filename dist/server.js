import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { GPTProtoClient, taskSnapshot, } from "./client.js";
import { extractApiResult, extractMedia } from "./results.js";
import { findPublicRoute } from "./routes.js";
import { TaskRegistry } from "./tasks.js";
const VERSION = "0.1.0";
function jsonText(value) {
    return JSON.stringify(value, null, 2);
}
function success(value, text) {
    return {
        content: [{ type: "text", text: text ?? jsonText(value) }],
        structuredContent: value && typeof value === "object" && !Array.isArray(value)
            ? value
            : { result: value },
    };
}
function failure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error && typeof error === "object" && "status" in error
        && typeof error.status === "number"
        ? error.status
        : undefined;
    return {
        content: [{ type: "text", text: message }],
        structuredContent: { error: message, ...(status === undefined ? {} : { http_status: status }) },
        isError: true,
    };
}
function callResult(result, outputJson = false, taskId) {
    if (Buffer.isBuffer(result.response.body)) {
        const mimeType = result.response.contentType.split(";", 1)[0] || "application/octet-stream";
        if (mimeType.startsWith("audio/")) {
            return {
                content: [{ type: "audio", data: result.response.body.toString("base64"), mimeType }],
                structuredContent: { ...(taskId ? { task_id: taskId } : {}), content_type: mimeType, bytes: result.response.body.length },
            };
        }
        if (mimeType.startsWith("image/")) {
            return {
                content: [{ type: "image", data: result.response.body.toString("base64"), mimeType }],
                structuredContent: { ...(taskId ? { task_id: taskId } : {}), content_type: mimeType, bytes: result.response.body.length },
            };
        }
        return failure(new Error("Binary API responses are not returned by this MCP tool"));
    }
    if (outputJson)
        return success(result.response.body);
    const extracted = extractApiResult(result.response.body, result.route.output);
    if (extracted.type === "error") {
        return {
            content: [{ type: "text", text: extracted.error ?? "GPTProto request failed" }],
            structuredContent: { ...(taskId ? { task_id: taskId } : {}), error: extracted.error },
            isError: true,
        };
    }
    if (extracted.type === "text") {
        return success({ ...(taskId ? { task_id: taskId } : {}), text: extracted.text }, extracted.text);
    }
    if (extracted.type === "media") {
        return success({ ...(taskId ? { task_id: taskId } : {}), urls: extracted.urls }, (extracted.urls ?? []).join("\n"));
    }
    return taskId ? success({ task_id: taskId, result: extracted.value }) : success(extracted.value);
}
function pairs(value) {
    if (!value)
        return undefined;
    return Object.entries(value).flatMap(([name, entry]) => Array.isArray(entry) ? entry.map((item) => [name, item]) : [[name, entry]]);
}
function requestModel(request) {
    if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
        const model = request.body.model;
        if (typeof model === "string" && model)
            return model;
    }
    return request.form?.find(([name]) => name === "model")?.[1];
}
function inferredResource(result, explicit) {
    if (explicit)
        return explicit;
    const value = `${result.route.family} ${result.route.path}`.toLowerCase();
    if (value.includes("image"))
        return "image";
    if (value.includes("video") || value.includes("veo") || value.includes("sora"))
        return "video";
    if (value.includes("audio") || value.includes("speech") || value.includes("transcription"))
        return "audio";
    if (result.route.output === "text" || /responses|messages|chat|completions|generatecontent/.test(value))
        return "text";
    return undefined;
}
function updateStoredTask(client, tasks, id, result) {
    const snapshot = taskSnapshot(result.response.body);
    const urls = extractMedia(result.response.body);
    tasks.upsert({
        id,
        ...(snapshot.status ? { status: snapshot.status } : {}),
        ...(snapshot.pollingUrl ? { polling_path: client.normalizePollingPath(snapshot.pollingUrl) } : {}),
        ...(urls.length ? { result_urls: urls } : {}),
    });
}
async function notifyTaskProgress(context, id, startedAt, status) {
    const token = context.mcpReq._meta?.progressToken;
    if (token === undefined)
        return;
    const elapsedSeconds = Math.min(Math.floor((Date.now() - startedAt) / 1000), 599);
    await context.mcpReq.notify({
        method: "notifications/progress",
        params: {
            progressToken: token,
            progress: elapsedSeconds,
            total: 600,
            message: `GPTProto task ${id}${status ? `: ${status}` : " submitted"}`,
        },
    });
}
function registerTask(client, tasks, result, request, resource, label, describedPollingPath) {
    const snapshot = taskSnapshot(result.response.body);
    if (!snapshot.id)
        return {};
    if (!snapshot.pollingUrl && result.route.async !== true && !resource)
        return {};
    const pollingPath = snapshot.pollingUrl
        ? client.normalizePollingPath(snapshot.pollingUrl)
        : describedPollingPath ?? result.route.pollPath;
    tasks.upsert({
        id: snapshot.id,
        method: request.method,
        path: request.path,
        model: requestModel(request),
        resource: inferredResource(result, resource),
        ...(pollingPath ? { polling_path: pollingPath } : {}),
        ...(label ? { label } : {}),
        ...(snapshot.status ? { status: snapshot.status } : {}),
    });
    return { id: snapshot.id, ...(pollingPath ? { pollingPath } : {}) };
}
async function pollingPathBeforeCreate(client, request) {
    if (findPublicRoute(request.method, request.path)?.async !== true)
        return undefined;
    try {
        return (await client.describeInvocation(request))?.pollingPath;
    }
    catch {
        return undefined;
    }
}
async function storedPollingPath(client, task) {
    if (!task)
        return undefined;
    if (task.polling_path)
        return task.polling_path;
    if (!task.model)
        return undefined;
    try {
        const described = await client.describeInvocation({
            method: task.method,
            path: task.path,
            body: { model: task.model },
        });
        return described?.pollingPath;
    }
    catch {
        return undefined;
    }
}
const stringValuesSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};
const actionAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
};
export function createServer(client = new GPTProtoClient(), tasks = new TaskRegistry()) {
    const server = new McpServer({ name: "gptproto", version: VERSION }, {
        instructions: "Discover models before calling them. Use gptproto_models_list, then gptproto_model_describe. " +
            "Use gptproto_pricing when price affects model selection. Never invent paths, parameters, enum values, or model availability. " +
            "Generation tools may incur charges; do not retry a failed generation or switch models without the user's approval. " +
            "Asynchronous creation saves its task ID first, then the MCP polls it internally for up to 600 seconds and returns the final result. Do not make the user drive polling. " +
            "If the tool call is interrupted, use gptproto_tasks_list to recover the saved task instead of submitting it again. " +
            "Upload a local file only when the user explicitly identified that file for the request.",
    });
    server.registerTool("gptproto_status", {
        title: "GPTProto configuration status",
        description: "Check whether the MCP uses the default API origin, whether an API key exists, and whether file uploads are enabled. Never returns the key or a custom origin.",
        annotations: readOnlyAnnotations,
    }, async () => success({ ...client.status(), mcp_version: VERSION }));
    server.registerTool("gptproto_models_list", {
        title: "List GPTProto models",
        description: "List live GPTProto models, optionally filtered by one broad capability. Use before choosing a model.",
        inputSchema: z.object({
            capability: z.enum(["text", "image", "video", "audio"]).optional(),
        }),
        annotations: readOnlyAnnotations,
    }, async ({ capability }) => {
        try {
            return success(await client.listModels(capability));
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_model_describe", {
        title: "Describe a GPTProto model",
        description: "Return a model's live methods, paths, native parameters, enums, response type, and asynchronous polling contract.",
        inputSchema: z.object({ model: z.string().describe("Exact provider/model ID") }),
        annotations: readOnlyAnnotations,
    }, async ({ model }) => {
        try {
            return success(await client.describeModel(model));
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_pricing", {
        title: "Query live GPTProto model pricing",
        description: "Read GPTProto's live public price catalog. Query one exact provider/model, search all models, or filter a capability and sort by its starting price.",
        inputSchema: z.object({
            model: z.string().optional().describe("Exact provider/model ID"),
            capability: z.enum(["text", "image", "video", "audio", "3d", "other"]).optional(),
            mode: z.string().optional().describe("Exact catalog operation tag, for example text-to-image or image-to-video"),
            search: z.string().optional().describe("Substring matched against model ID, alias, catalog model, and tags"),
            sort: z.enum(["catalog", "name", "price"]).default("catalog"),
            limit: z.number().int().positive().max(500).optional(),
            language: z.string().default("en"),
        }),
        annotations: readOnlyAnnotations,
    }, async (query) => {
        try {
            const result = await client.pricing(query);
            if (query.model && result.models.length === 0)
                return failure(new Error(`No price was found for ${query.model}`));
            return success(query.model ? result.models[0] : result);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_request", {
        title: "Call a documented GPTProto API",
        description: "MCP equivalent of `gptproto request`: call a relative method/path published by gptproto_model_describe with the same native JSON, multipart, header, and query fields. Official-compatible model fields have the provider prefix removed automatically.",
        inputSchema: z.object({
            method: z.enum(["GET", "POST"]),
            path: z.string().startsWith("/"),
            body: z.record(z.string(), z.unknown()).optional(),
            form: stringValuesSchema.optional(),
            files: z.array(z.object({
                field: z.string(),
                path: z.string().describe("Local file explicitly selected by the user for this request"),
                content_type: z.string().optional(),
            })).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            query: stringValuesSchema.optional(),
            stream: z.boolean().default(false).describe("Request the interface's native stream and return the assembled final text"),
            label: z.string().max(200).optional().describe("Optional local recovery label; stored locally and never sent to GPTProto"),
            allow_review: z.boolean().default(false),
            output_json: z.boolean().default(false).describe("Return the original API JSON instead of the extracted text or media URLs"),
        }),
        annotations: actionAnnotations,
    }, async ({ method, path, body, form, files, headers, query, stream, label, allow_review, output_json }, context) => {
        try {
            const request = {
                method,
                path,
                body: stream ? { ...(body ?? {}), stream: true } : body,
                form: pairs(form),
                files: files?.map((file) => ({ field: file.field, path: file.path, contentType: file.content_type })),
                headers,
                query: pairs(query),
                allowReview: allow_review,
            };
            const describedPollingPath = await pollingPathBeforeCreate(client, request);
            let result = await client.request(request);
            const tracked = registerTask(client, tasks, result, request, undefined, label, describedPollingPath);
            if (tracked.id) {
                const startedAt = Date.now();
                await notifyTaskProgress(context, tracked.id, startedAt);
                result = await client.waitForCall(result, request, {
                    pollingPath: tracked.pollingPath,
                    timeoutSeconds: 600,
                    onUpdate: async (update) => {
                        updateStoredTask(client, tasks, tracked.id, update);
                        await notifyTaskProgress(context, tracked.id, startedAt, taskSnapshot(update.response.body).status);
                    },
                });
            }
            return callResult(result, output_json, tracked.id);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_custom_create", {
        title: "Create a GPTProto custom generation task",
        description: "Submit an existing GPTProto custom image, video, audio, lip-sync, 3D, or image-edit request using its documented native body.",
        inputSchema: z.object({
            resource: z.enum(["image", "video", "speech", "voice-clone", "lip-sync", "3d", "image-edit"]),
            body: z.record(z.string(), z.unknown()),
            label: z.string().max(200).optional().describe("Optional local recovery label; stored locally and never sent to GPTProto"),
            output_json: z.boolean().default(false),
        }),
        annotations: actionAnnotations,
    }, async ({ resource, body, label, output_json }, context) => {
        try {
            const request = {
                method: "POST",
                path: client.customPath(resource),
                body,
            };
            const describedPollingPath = await pollingPathBeforeCreate(client, request);
            let result = await client.customCreate(resource, body);
            const tracked = registerTask(client, tasks, result, request, resource, label, describedPollingPath);
            if (tracked.id) {
                const startedAt = Date.now();
                await notifyTaskProgress(context, tracked.id, startedAt);
                result = await client.waitForCall(result, request, {
                    resource,
                    pollingPath: tracked.pollingPath,
                    timeoutSeconds: 600,
                    onUpdate: async (update) => {
                        updateStoredTask(client, tasks, tracked.id, update);
                        await notifyTaskProgress(context, tracked.id, startedAt, taskSnapshot(update.response.body).status);
                    },
                });
            }
            return callResult(result, output_json, tracked.id);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_tasks_list", {
        title: "List recoverable GPTProto tasks",
        description: "List recent asynchronous tasks saved locally, including their IDs, model, type, time, state, and completed result URLs. Use this after an interrupted tool call or in a new conversation before creating another task.",
        inputSchema: z.object({
            model: z.string().optional(),
            resource: z.enum(["text", "image", "video", "audio", "speech", "voice-clone", "lip-sync", "3d", "image-edit"]).optional(),
            status: z.string().optional(),
            limit: z.number().int().positive().max(200).default(20),
        }),
        annotations: readOnlyAnnotations,
    }, async (query) => {
        try {
            const listed = tasks.list(query);
            return success({ tasks: listed, count: listed.length });
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_task_get", {
        title: "Get a GPTProto task",
        description: "Perform exactly one status query for a saved task after an interrupted automatic wait. It never resubmits or internally loops.",
        inputSchema: z.object({
            task_id: z.string(),
            video: z.boolean().default(false),
            path: z.string().startsWith("/").optional().describe("CLI-compatible custom task path template containing {id}"),
            output_json: z.boolean().default(false),
        }),
        annotations: readOnlyAnnotations,
    }, async ({ task_id, video, path, output_json }) => {
        try {
            const stored = tasks.get(task_id);
            const pollingPath = path ?? await storedPollingPath(client, stored);
            const result = await client.taskGet(task_id, video || stored?.resource === "video", pollingPath);
            if (stored)
                updateStoredTask(client, tasks, task_id, result);
            return callResult(result, output_json);
        }
        catch (error) {
            return failure(error);
        }
    });
    server.registerTool("gptproto_task_wait", {
        title: "Wait for a GPTProto task",
        description: "Resume MCP-owned polling for an existing known task after an interrupted creation call. It never resubmits and is capped at 600 seconds.",
        inputSchema: z.object({
            task_id: z.string(),
            video: z.boolean().default(false),
            path: z.string().startsWith("/").optional().describe("CLI-compatible polling path template containing {id}"),
            interval_ms: z.number().int().positive().optional(),
            timeout_seconds: z.number().positive().max(600).default(600),
            output_json: z.boolean().default(false),
        }),
        annotations: readOnlyAnnotations,
    }, async ({ task_id, video, path, interval_ms, timeout_seconds, output_json }, context) => {
        try {
            const stored = tasks.get(task_id);
            const pollingPath = path ?? await storedPollingPath(client, stored);
            const startedAt = Date.now();
            await notifyTaskProgress(context, task_id, startedAt, stored?.status);
            const result = await client.taskWait(task_id, {
                video: video || stored?.resource === "video",
                pollingPath,
                intervalMs: interval_ms,
                timeoutSeconds: timeout_seconds,
                onUpdate: async (update) => {
                    updateStoredTask(client, tasks, task_id, update);
                    await notifyTaskProgress(context, task_id, startedAt, taskSnapshot(update.response.body).status);
                },
            });
            return callResult(result, output_json);
        }
        catch (error) {
            return failure(error);
        }
    });
    return server;
}
