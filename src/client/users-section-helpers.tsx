/**
 * users-section 客户端测试的共享基座：jsdom 渲染 + 路由式 fetch mock + 行/按钮定位。
 * 与 test/user-admin-harness.ts 同位（后者管 host 端点，本文件管 client 设置页）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
import { SettingsUsersSection } from "./users-section.tsx";

export interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

export type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: { method?: string; body?: string }) => Promise<unknown>>
>;

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

export async function renderSection(
  t: (key: string) => string,
): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsUsersSection, { t }));
    await flushMicrotasks();
  });
  return { root, container };
}

export function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

/** 路由式 fetch mock：GET 列表 + 记录全部变更调用；settings PATCH 回显 sessionTtl。 */
export function makeFetchMock(users: AdminUser[], mutation?: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const mock = vi.fn((url: string, init?: { method?: string; body?: string }): Promise<unknown> => {
    const method = init?.method ?? "GET";
    const parsed =
      init?.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({ url, method, ...(parsed === undefined ? {} : { body: parsed }) });
    if (url === "/auth/settings") {
      const body =
        method === "PATCH"
          ? { sessionTtl: parsed?.["sessionTtl"], defaultTtl: 604800 }
          : { sessionTtl: 604800, defaultTtl: 604800 };
      return Promise.resolve(jsonResponse(200, body));
    }
    const body = method === "GET" ? { users } : (mutation?.body ?? {});
    const status = method === "GET" ? 200 : (mutation?.status ?? 200);
    return Promise.resolve(jsonResponse(status, body));
  });
  return { mock, calls };
}

export function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`button not found: ${text}`);
  return button;
}

/** 按用户名定位行容器（行首 span 文本精确匹配）。 */
export function rowOf(container: HTMLElement, username: string): HTMLElement {
  const name = [...container.querySelectorAll("span")].find(
    (candidate) => candidate.textContent === username,
  );
  const row = name?.parentElement;
  if (row == null) throw new Error(`row not found: ${username}`);
  return row;
}

export async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
  });
}

export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushMicrotasks();
  });
}
