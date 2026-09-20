export type HttpMethod = "GET" | "POST";

export interface PublicRoute {
  readonly family: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly output?: "text";
  readonly async?: boolean;
  readonly pollPath?: string;
  readonly requiresReview?: boolean;
  readonly aliases?: readonly string[];
}

// Public API inventory only. No server implementation details are stored here.
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { family: "GPTProto custom", method: "POST", path: "/api/v3/videos", async: true, pollPath: "/api/v3/videos/{id}" },
  { family: "GPTProto custom", method: "GET", path: "/api/v3/videos/{id}" },
  { family: "GPTProto custom", method: "GET", path: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/images", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/audio/speech", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/audio/voice-clone", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/lip-sync", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/3d", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "GPTProto custom", method: "POST", path: "/api/v3/images/edit", async: true, pollPath: "/api/v3/tasks/result/{id}" },
  { family: "OpenAI-compatible", method: "GET", path: "/v1/models" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/audio/speech" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/audio/transcriptions", output: "text" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/images/generations" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/images/edits", requiresReview: true },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/embeddings" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/chat/completions", output: "text" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/responses", output: "text" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/completions", output: "text" },
  { family: "OpenAI-compatible", method: "POST", path: "/v1/moderations" },
  { family: "Anthropic Claude", method: "POST", path: "/v1/messages", output: "text" },
  { family: "Google Gemini", method: "POST", path: "/v1beta/models/{model}:generateContent", output: "text" },
  { family: "Google Gemini", method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", output: "text", aliases: ["/google/v1beta/models/{model}:streamGenerateContent"] },
  { family: "Google-compatible", method: "POST", path: "/v1beta/openai/chat/completions", output: "text" },
  { family: "Google Gemini", method: "POST", path: "/upload/v1beta/files" },
  { family: "Google Gemini", method: "GET", path: "/v1beta/files/{fileId}" },
  { family: "Google Veo", method: "POST", path: "/v1beta/models/{model}:predictLongRunning", async: true, pollPath: "/v1beta/models/{model}/operations/{operation_id}" },
  { family: "Google Veo", method: "GET", path: "/v1beta/models/{model}/operations/{operation_id}" },
  { family: "Google Veo", method: "GET", path: "/v1beta/files/{operation_id}:download", requiresReview: true },
  { family: "Alibaba Wan", method: "POST", path: "/api/v1/services/aigc/text2image/image-synthesis", async: true, pollPath: "/api/v1/tasks/{task_id}" },
  { family: "Alibaba Wan", method: "POST", path: "/api/v1/services/aigc/image2image/image-synthesis", async: true, pollPath: "/api/v1/tasks/{task_id}" },
  { family: "Alibaba Wan", method: "GET", path: "/api/v1/tasks/{task_id}" },
  { family: "Vidu", method: "POST", path: "/ent/v2/reference2image", async: true, pollPath: "/ent/v2/tasks/{taskId}/creations" },
  { family: "Vidu", method: "GET", path: "/ent/v2/tasks/{taskId}/creations" },
  { family: "Kling", method: "POST", path: "/kling/v1/videos/text2video", async: true, pollPath: "/kling/v1/videos/text2video/{task_id}" },
  { family: "Kling", method: "POST", path: "/kling/v1/videos/image2video", async: true, pollPath: "/kling/v1/videos/image2video/{task_id}" },
  { family: "Kling", method: "POST", path: "/kling/v1/videos/video-extend", async: true, pollPath: "/kling/v1/videos/video-extend/{task_id}" },
  { family: "Kling", method: "POST", path: "/kling/v1/images/generations", async: true, pollPath: "/kling/v1/images/generations/{task_id}" },
  { family: "Kling", method: "GET", path: "/kling/v1/{action}/{action2}/{task_id}" },
  { family: "Runway", method: "POST", path: "/runway/v1/pro/act_one", async: true, pollPath: "/v1/runway/tasks/{id}" },
  { family: "Runway", method: "POST", path: "/runway/v1/pro/act_two", async: true, pollPath: "/v1/runway/tasks/{id}" },
  { family: "Runway", method: "POST", path: "/runway/v1/pro/generate", async: true, pollPath: "/v1/runway/tasks/{id}" },
  { family: "Runway", method: "POST", path: "/runway/v1/pro/video2video", async: true, pollPath: "/v1/runway/tasks/{id}" },
  { family: "Runway", method: "POST", path: "/runwayml/v1/image_to_video", async: true, pollPath: "/v1/runway/tasks/{id}" },
  { family: "Runway", method: "GET", path: "/v1/runway/tasks/{id}", aliases: ["/runway/tasks/{id}", "/runway/v1/tasks/{id}"] },
  { family: "OpenAI Sora", method: "POST", path: "/v1/videos", async: true, pollPath: "/v1/videos/{video_id}" },
  { family: "OpenAI Sora", method: "GET", path: "/v1/videos/{video_id}" },
  { family: "OpenAI Sora", method: "POST", path: "/v1/videos/{video_id}/remix", async: true, pollPath: "/v1/videos/{video_id}" },
  { family: "OpenAI Sora", method: "GET", path: "/v1/videos/{video_id}/content", requiresReview: true },
];

function pathRegex(template: string): RegExp {
  const pattern = template.split(/(\{[^}]+\})/g).map((part) =>
    /^\{[^}]+\}$/.test(part) ? "[^/:]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("");
  return new RegExp(`^${pattern}$`);
}

export function matchesPathTemplate(template: string, path: string): boolean {
  return pathRegex(template).test(path.split("?", 1)[0]);
}

export function findPublicRoute(method: string, path: string): PublicRoute | undefined {
  const pathname = path.split("?", 1)[0];
  return PUBLIC_ROUTES.find((route) => route.method === method.toUpperCase() &&
    [route.path, ...(route.aliases ?? [])].some((candidate) => matchesPathTemplate(candidate, pathname)));
}
