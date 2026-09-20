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
export declare class TaskRegistry {
    readonly file: string;
    constructor(file?: string);
    private read;
    private write;
    get(id: string): StoredTask | undefined;
    upsert(update: TaskUpdate): StoredTask;
    list(query?: TaskListQuery): StoredTask[];
}
