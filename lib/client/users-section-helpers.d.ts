import { type Root } from "react-dom/client";
import { vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
export interface Call {
    url: string;
    method: string;
    body?: Record<string, unknown>;
}
export type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: {
    method?: string;
    body?: string;
}) => Promise<unknown>>>;
export declare function flushMicrotasks(): Promise<void>;
export declare function renderSection(t: (key: string) => string): Promise<{
    root: Root;
    container: HTMLDivElement;
}>;
export declare function jsonResponse(status: number, body: unknown): unknown;
/** 路由式 fetch mock：GET 列表 + 记录全部变更调用；settings PATCH 回显 sessionTtl。 */
export declare function makeFetchMock(users: AdminUser[], mutation?: {
    status: number;
    body: unknown;
}): {
    mock: import("vitest").Mock<(url: string, init?: {
        method?: string;
        body?: string;
    }) => Promise<unknown>>;
    calls: Call[];
};
export declare function buttonByText(container: HTMLElement, text: string): HTMLButtonElement;
/** 按用户名定位行容器（行首 span 文本精确匹配）。 */
export declare function rowOf(container: HTMLElement, username: string): HTMLElement;
export declare function click(element: HTMLElement): Promise<void>;
export declare function typeInto(input: HTMLInputElement, value: string): Promise<void>;
//# sourceMappingURL=users-section-helpers.d.ts.map