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
export declare const PUBLIC_ROUTES: readonly PublicRoute[];
export declare function matchesPathTemplate(template: string, path: string): boolean;
export declare function findPublicRoute(method: string, path: string): PublicRoute | undefined;
