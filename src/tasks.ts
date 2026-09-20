import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_TASKS = 200;

export interface StoredTask {
  readonly id: string;
  readonly model?: string;
  readonly resource?: string;
  readonly method: string;
  readonly path: string;
  readonly polling_path?: string;
  readonly label?: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status?: string;
  readonly result_urls?: readonly string[];
}

export interface TaskUpdate {
  readonly id: string;
  readonly model?: string;
  readonly resource?: string;
  readonly method?: string;
  readonly path?: string;
  readonly polling_path?: string;
  readonly label?: string;
  readonly status?: string;
  readonly result_urls?: readonly string[];
}

export interface TaskListQuery {
  readonly model?: string;
  readonly resource?: string;
  readonly status?: string;
  readonly limit?: number;
}

function taskFile(): string {
  return process.env.GPTPROTO_MCP_TASKS_FILE?.trim()
    || join(homedir(), ".config", "gptproto-mcp", "tasks.json");
}

function validTask(value: unknown): value is StoredTask {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.method === "string"
    && typeof entry.path === "string"
    && typeof entry.created_at === "string"
    && typeof entry.updated_at === "string";
}

export class TaskRegistry {
  readonly file: string;

  constructor(file = taskFile()) {
    this.file = file;
  }

  private read(): StoredTask[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)
          ? (parsed as { tasks: unknown[] }).tasks
          : [];
      return values.filter(validTask);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw new Error("Unable to read the local GPTProto task registry");
    }
  }

  private write(tasks: readonly StoredTask[]): void {
    const directory = dirname(this.file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const temporary = join(directory, `.tasks-${process.pid}-${Date.now()}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify({ tasks }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.file);
      chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error("Unable to update the local GPTProto task registry", { cause: error });
    }
  }

  get(id: string): StoredTask | undefined {
    return this.read().find((task) => task.id === id);
  }

  upsert(update: TaskUpdate): StoredTask {
    const tasks = this.read();
    const current = tasks.find((task) => task.id === update.id);
    const now = new Date().toISOString();
    const next: StoredTask = {
      id: update.id,
      method: update.method ?? current?.method ?? "GET",
      path: update.path ?? current?.path ?? "",
      created_at: current?.created_at ?? now,
      updated_at: now,
      ...(update.model ?? current?.model ? { model: update.model ?? current?.model } : {}),
      ...(update.resource ?? current?.resource ? { resource: update.resource ?? current?.resource } : {}),
      ...(update.polling_path ?? current?.polling_path
        ? { polling_path: update.polling_path ?? current?.polling_path }
        : {}),
      ...(update.label ?? current?.label ? { label: update.label ?? current?.label } : {}),
      ...(update.status ?? current?.status ? { status: update.status ?? current?.status } : {}),
      ...(update.result_urls ?? current?.result_urls
        ? { result_urls: update.result_urls ?? current?.result_urls }
        : {}),
    };
    this.write([next, ...tasks.filter((task) => task.id !== update.id)].slice(0, MAX_TASKS));
    return next;
  }

  list(query: TaskListQuery = {}): StoredTask[] {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_TASKS);
    return this.read().filter((task) =>
      (!query.model || task.model === query.model)
      && (!query.resource || task.resource === query.resource)
      && (!query.status || task.status === query.status.toLowerCase()),
    ).slice(0, limit);
  }
}
