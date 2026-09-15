// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
import { USERS_DICT_EN } from "./users-dict.ts";
import { SettingsUsersSection } from "./users-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string): string => USERS_DICT_EN[key] ?? key;

/** 非 admin 视角：carol 登录（current），alice 是另一位 admin。 */
const CAROL_SELF: AdminUser = {
  username: "carol",
  disabled: false,
  totp: false,
  admin: false,
  current: true,
};
const ALICE_OTHER: AdminUser = {
  username: "alice",
  disabled: false,
  totp: false,
  admin: true,
  current: false,
};

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function renderSection(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsUsersSection, { t }));
    await flushMicrotasks();
  });
  return { root, container };
}

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** 路由式 fetch mock：GET 列表 + 记录全部变更调用。 */
function makeFetchMock(users: AdminUser[], mutation?: { status: number; body: unknown }) {
  const calls: Call[] = [];
  const mock = vi.fn((url: string, init?: { method?: string; body?: string }): Promise<unknown> => {
    const method = init?.method ?? "GET";
    const parsed =
      init?.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({ url, method, ...(parsed === undefined ? {} : { body: parsed }) });
    if (url === "/auth/settings") {
      return Promise.resolve(jsonResponse(200, { sessionTtl: 604800, defaultTtl: 604800 }));
    }
    const body = method === "GET" ? { users } : (mutation?.body ?? {});
    const status = method === "GET" ? 200 : (mutation?.status ?? 200);
    return Promise.resolve(jsonResponse(status, body));
  });
  return { mock, calls };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`button not found: ${text}`);
  return button;
}

/** 按用户名定位行容器（行首 span 文本精确匹配）。 */
function rowOf(container: HTMLElement, username: string): HTMLElement {
  const name = [...container.querySelectorAll("span")].find(
    (candidate) => candidate.textContent === username,
  );
  const row = name?.parentElement;
  if (row == null) throw new Error(`row not found: ${username}`);
  return row;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
  });
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushMicrotasks();
  });
}

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: { method?: string; body?: string }) => Promise<unknown>>
>;

const fetchMock: FetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("SettingsUsersSection as non-admin (D13)", () => {
  it("hides the add form and all admin actions; only the own password editor remains", async () => {
    const { mock } = makeFetchMock([ALICE_OTHER, CAROL_SELF]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    expect(container.querySelector("input[type='text']")).toBeNull();
    const texts = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(texts).toEqual(["Change password"]);
    expect(container.textContent).toContain("admin");
    expect(container.textContent).toContain(
      "Only admins can add or manage other users; you can change your own password.",
    );
    root.unmount();
    container.remove();
  });

  it("changes the own password through the inline editor", async () => {
    const { mock, calls } = makeFetchMock([ALICE_OTHER, CAROL_SELF]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(rowOf(container, "carol"), "Change password"));
    await typeInto(container.querySelector("input[type='password']")!, "new-pw");
    await click(buttonByText(rowOf(container, "carol"), "Save"));
    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.body?.["username"] === "carol" &&
          c.body?.["password"] === "new-pw",
      ),
    ).toBe(true);
    root.unmount();
    container.remove();
  });

  it("localizes the forbidden error code", async () => {
    const { mock } = makeFetchMock([ALICE_OTHER, CAROL_SELF], {
      status: 403,
      body: { error: "forbidden" },
    });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(rowOf(container, "carol"), "Change password"));
    await typeInto(container.querySelector("input[type='password']")!, "new-pw");
    await click(buttonByText(rowOf(container, "carol"), "Save"));
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Permission denied: admins only.",
    );
    root.unmount();
    container.remove();
  });

  it("shows the login timeout read-only (value only, no editor)", async () => {
    const { mock } = makeFetchMock([ALICE_OTHER, CAROL_SELF]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    expect(container.textContent).toContain("Login timeout");
    expect(container.textContent).toContain("168 hours (7 days)");
    expect(container.querySelector("input[type='number']")).toBeNull();
    root.unmount();
    container.remove();
  });
});
