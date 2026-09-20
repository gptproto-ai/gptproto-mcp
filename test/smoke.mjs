import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { pollIntervalForElapsed } from "../dist/client.js";
import { extractMedia, extractText } from "../dist/results.js";
import { TaskRegistry } from "../dist/tasks.js";

assert.equal(extractText({ output_text: ["one", { text: " two" }] }), "one two");
assert.equal(extractText('{"content":[{"type":"text","text":"Claude text"}]}'), "Claude text");
assert.equal(extractText({ choices: [{ message: { content: "Chat text" } }] }), "Chat text");
assert.equal(extractText({ candidates: [{ content: { parts: [{ text: "Gemini text" }] } }] }), "Gemini text");
assert.deepEqual(
  extractMedia({ data: { unsigned_urls: ["https://cdn.example.test/result.png"] }, polling_url: "https://ignored.example.test" }),
  ["https://cdn.example.test/result.png"],
);
assert.equal(pollIntervalForElapsed(10_000, 0), 10_000);
assert.equal(pollIntervalForElapsed(10_000, 59_999), 10_000);
assert.equal(pollIntervalForElapsed(10_000, 60_000), 8_000);
assert.equal(pollIntervalForElapsed(10_000, 179_999), 8_000);
assert.equal(pollIntervalForElapsed(10_000, 180_000), 5_000);
assert.equal(pollIntervalForElapsed(5, 180_000), 5);
assert.equal(pollIntervalForElapsed(15_000, 0), 10_000);

let imagePolls = 0;
let videoPolls = 0;
let wanPolls = 0;
const catalog = {
  data: {
    items: [
      {
        id: 1,
        modelManufacturerName: "OpenAI",
        modelName: "gpt-4.1/text-to-text",
        alias: "GPT 4.1",
        platformInputPrice: "1.4",
        platformOutPrice: "5.6",
        platformLockPrice: null,
        priceType: 1000000,
        priceTypeStr: "1M tokens",
        modelTag: "text-to-text,image-to-text",
      },
      {
        id: 2,
        modelManufacturerName: "Bytedance",
        modelName: "seedream-fast/text-to-image",
        alias: "Seedream Fast",
        platformInputPrice: "",
        platformOutPrice: "",
        platformLockPrice: "0.02",
        priceType: -1,
        priceTypeStr: "per time",
        modelTag: "text-to-image,image-edit",
      },
    ],
  },
};

const api = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (request.url === "/api/home-model-catalog?language=en") {
      assert.equal(request.headers.authorization, undefined);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(catalog));
      return;
    }
    assert.equal(request.headers.authorization, "Bearer mcp-test-key");
    if (request.method === "GET" && request.url === "/v1/cli/models?capability=text") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ id: "openai/gpt-4.1", capabilities: ["text"] }] }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/cli/models/openai/gpt-4.1") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "openai/gpt-4.1",
        capabilities: ["text"],
        interfaces: [{
          id: "openai-responses",
          method: "POST",
          path: "/v1/responses",
          capability: "text",
          mode: "generate",
          request: { parameters: { model: { type: "string" }, input: { type: "string" } } },
        }],
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/cli/models/bytedance/seedance-test") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "bytedance/seedance-test",
        capabilities: ["video"],
        interfaces: [{
          method: "POST",
          path: "/api/v3/videos",
          async: true,
          poll_path: "/api/v3/tasks/result/{id}",
        }],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "gpt-4.1");
      if (parsed.stream === true) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          'data: {"type":"response.output_text.delta","delta":"MCP "}\n\n' +
          'data: {"type":"response.output_text.delta","delta":"stream"}\n\n' +
          'data: {"type":"response.output_text.done","text":"MCP stream"}\n\n' +
          'data: [DONE]\n\n',
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "response-test",
        output: [{ type: "message", content: [{ type: "output_text", text: "MCP text result" }] }],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/audio/speech") {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "tts-1");
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(Buffer.from("mock-audio"));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/services/aigc/text2image/image-synthesis") {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "wanx-v1");
      assert.equal(request.headers["x-dashscope-async"], "enable");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ task_id: "wan-task", status: "pending" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/tasks/wan-task") {
      wanPolls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        task_id: "wan-task",
        status: "completed",
        output: "https://cdn.example.test/wan.png",
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v3/videos") {
      assert.equal(JSON.parse(body).model, "bytedance/seedance-test");
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "video-task", status: "pending" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/v3/tasks/result/video-task") {
      videoPolls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "video-task",
        status: "completed",
        outputs: ["https://cdn.example.test/video.mp4"],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v3/images") {
      assert.equal(JSON.parse(body).model, "bytedance/seedream-fast");
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "image-task",
        status: "pending",
        polling_url: "/api/v3/tasks/result/image-task",
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/v3/tasks/result/image-task") {
      imagePolls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "image-task",
        status: "completed",
        unsigned_urls: ["https://cdn.example.test/image.png"],
      }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Not found: ${request.method} ${request.url}` } }));
  });
});

await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const address = api.address();
if (!address || typeof address === "string") throw new Error("mock API did not start");
const taskDirectory = mkdtempSync(join(tmpdir(), "gptproto-mcp-test-"));
const taskFile = join(taskDirectory, "tasks.json");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    GPTPROTO_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    GPTPROTO_PRICE_CATALOG_URL: `http://127.0.0.1:${address.port}/api/home-model-catalog`,
    GPTPROTO_API_KEY: "mcp-test-key",
    GPTPROTO_POLL_INTERVAL_MS: "5",
    GPTPROTO_MAX_POLL_SECONDS: "2",
    GPTPROTO_MCP_TASKS_FILE: taskFile,
  },
  stderr: "pipe",
});
const client = new Client({ name: "gptproto-mcp-test", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    "gptproto_custom_create",
    "gptproto_model_describe",
    "gptproto_models_list",
    "gptproto_pricing",
    "gptproto_request",
    "gptproto_status",
    "gptproto_task_get",
    "gptproto_task_wait",
    "gptproto_tasks_list",
  ]);
  const createTool = listed.tools.find((tool) => tool.name === "gptproto_custom_create");
  const requestTool = listed.tools.find((tool) => tool.name === "gptproto_request");
  assert.equal("wait" in createTool.inputSchema.properties, false);
  assert.equal("wait" in requestTool.inputSchema.properties, false);

  const status = await client.callTool({ name: "gptproto_status", arguments: {} });
  assert.equal(status.structuredContent.api_key_configured, true);
  assert.equal(status.structuredContent.file_uploads_enabled, false);
  assert.equal(status.structuredContent.timeout_ms, 600_000);
  assert.equal("api_base_url" in status.structuredContent, false);
  assert.equal(JSON.stringify(status).includes("mcp-test-key"), false);

  const models = await client.callTool({
    name: "gptproto_models_list",
    arguments: { capability: "text" },
  });
  assert.equal(models.structuredContent.models[0].id, "openai/gpt-4.1");

  const model = await client.callTool({
    name: "gptproto_model_describe",
    arguments: { model: "openai/gpt-4.1" },
  });
  assert.equal(model.structuredContent.interfaces[0].path, "/v1/responses");

  const pricing = await client.callTool({
    name: "gptproto_pricing",
    arguments: { capability: "image", sort: "price", limit: 1 },
  });
  assert.equal(pricing.structuredContent.models[0].id, "bytedance/seedream-fast");

  const text = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/responses",
      body: { model: "openai/gpt-4.1", input: "hello" },
    },
  });
  assert.equal(text.structuredContent.text, "MCP text result");
  assert.equal(text.content[0].text, "MCP text result");

  const rawText = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/responses",
      body: { model: "openai/gpt-4.1", input: "hello" },
      output_json: true,
    },
  });
  assert.equal(rawText.structuredContent.id, "response-test");
  assert.equal(rawText.structuredContent.text, undefined);

  const streamed = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/responses",
      body: { model: "openai/gpt-4.1", input: "hello" },
      stream: true,
    },
  });
  assert.equal(streamed.structuredContent.text, "MCP stream");

  const audio = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/audio/speech",
      body: { model: "openai/tts-1", input: "hello", voice: "alloy" },
    },
  });
  assert.equal(audio.content[0].type, "audio");
  assert.equal(audio.structuredContent.content_type, "audio/mpeg");

  const headerRequest = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/api/v1/services/aigc/text2image/image-synthesis",
      body: { model: "alibaba/wanx-v1", input: { prompt: "tiger" } },
      headers: { "X-DashScope-Async": "enable" },
    },
  });
  assert.equal(headerRequest.structuredContent.task_id, "wan-task");
  assert.deepEqual(headerRequest.structuredContent.urls, ["https://cdn.example.test/wan.png"]);
  assert.equal(wanPolls, 1);

  const reviewRequired = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/images/edits",
      body: { model: "openai/gpt-image-2", prompt: "edit" },
    },
  });
  assert.equal(reviewRequired.isError, true);
  assert.match(reviewRequired.structuredContent.error, /explicit contract review/);

  const image = await client.callTool({
    name: "gptproto_custom_create",
    arguments: {
      resource: "image",
      body: { model: "bytedance/seedream-fast", prompt: "A tiger" },
    },
  });
  assert.equal(image.structuredContent.task_id, "image-task");
  assert.deepEqual(image.structuredContent.urls, ["https://cdn.example.test/image.png"]);
  assert.equal(imagePolls, 1);

  const imageResult = await client.callTool({
    name: "gptproto_task_get",
    arguments: { task_id: "image-task" },
  });
  assert.deepEqual(imageResult.structuredContent.urls, ["https://cdn.example.test/image.png"]);
  assert.equal(imagePolls, 2);

  const videoProgress = [];
  const video = await client.callTool({
    name: "gptproto_custom_create",
    arguments: {
      resource: "video",
      body: { model: "bytedance/seedance-test", prompt: "A city" },
      label: "city recovery test",
    },
  }, {
    onprogress: (progress) => { videoProgress.push(progress); },
    timeout: 600_000,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: 600_000,
  });
  assert.equal(video.structuredContent.task_id, "video-task");
  assert.deepEqual(video.structuredContent.urls, ["https://cdn.example.test/video.mp4"]);
  assert.equal(videoPolls, 1);
  assert.ok(videoProgress.length >= 2);
  assert.match(videoProgress[0].message, /video-task/);

  const tasks = await client.callTool({
    name: "gptproto_tasks_list",
    arguments: { resource: "video" },
  });
  assert.equal(tasks.structuredContent.tasks[0].id, "video-task");
  assert.equal(tasks.structuredContent.tasks[0].model, "bytedance/seedance-test");
  assert.equal(tasks.structuredContent.tasks[0].label, "city recovery test");
  assert.equal(tasks.structuredContent.tasks[0].polling_path, "/api/v3/tasks/result/{id}");
  assert.equal(JSON.stringify(tasks.structuredContent).includes("A city"), false);

  const resumedVideo = await client.callTool({
    name: "gptproto_task_get",
    arguments: { task_id: "video-task" },
  });
  assert.deepEqual(resumedVideo.structuredContent.urls, ["https://cdn.example.test/video.mp4"]);
  assert.equal(videoPolls, 2);

  const recoveredFromDisk = new TaskRegistry(taskFile).get("video-task");
  assert.equal(recoveredFromDisk?.status, "completed");
  assert.deepEqual(recoveredFromDisk?.result_urls, ["https://cdn.example.test/video.mp4"]);
  assert.equal(statSync(taskFile).mode & 0o777, 0o600);
  assert.equal(readFileSync(taskFile, "utf8").includes("A city"), false);

  const waited = await client.callTool({
    name: "gptproto_task_wait",
    arguments: { task_id: "image-task" },
  });
  assert.deepEqual(waited.structuredContent.urls, ["https://cdn.example.test/image.png"]);
  assert.equal(imagePolls, 3);

  const rejected = await client.callTool({
    name: "gptproto_request",
    arguments: { method: "GET", path: "/not-a-public-route" },
  });
  assert.equal(rejected.isError, true);
  assert.match(rejected.structuredContent.error, /Unlisted public route/);
  assert.equal("details" in rejected.structuredContent, false);

  const blockedUpload = await client.callTool({
    name: "gptproto_request",
    arguments: {
      method: "POST",
      path: "/v1/audio/transcriptions",
      form: { model: "openai/whisper-1" },
      files: [{ field: "file", path: "/tmp/not-read-by-test.wav" }],
    },
  });
  assert.equal(blockedUpload.isError, true);
  assert.match(blockedUpload.structuredContent.error, /Local file uploads are disabled/);
} finally {
  await client.close();
  await new Promise((resolve) => api.close(resolve));
  rmSync(taskDirectory, { recursive: true, force: true });
}

console.log("gptproto-mcp smoke test passed");
