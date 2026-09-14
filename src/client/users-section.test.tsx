// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
import { USERS_DICT_EN } from "./users-dict.ts";
import { SettingsUsersSection } from "./users-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string): string => USERS_DICT_EN[key] ?? key;

const ALICE: AdminUser = { username: "alice", disabled: false, totp: false, current: true };
const BOB: AdminUser = { username: "bob", disabled: true, totp: true, current: false };

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: { method?: string; body?: string }) => Promise<unknown>>
>;

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
    const body = method === "GET" ? { users } : (mutation?.body ?? { user: BOB });
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

const fetchMock: FetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("SettingsUsersSection states", () => {
  it("lists users with status badges after loading", async () => {
    const { mock } = makeFetchMock([ALICE, BOB]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    expect(container.textContent).toContain("alice");
    expect(container.textContent).toContain("bob");
    expect(container.textContent).toContain("you");
    expect(container.textContent).toContain("disabled");
    expect(container.textContent).toContain("TOTP");
    root.unmount();
    container.remove();
  });

  it("shows the unavailable notice in token mode (GET 404)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    const { root, container } = await renderSection();
    expect(container.textContent).toContain("unavailable in token mode");
    root.unmount();
    container.remove();
  });

  it("shows a retryable error when the list fails to load", async () => {
    const { mock } = makeFetchMock([ALICE]);
    fetchMock.mockImplementation(mock);
    fetchMock.mockRejectedValueOnce(new Error("network")); // 仅首次 GET 失败
    const { root, container } = await renderSection();
    expect(container.textContent).toContain("Failed to load the user list.");
    await click(buttonByText(container, "Retry"));
    expect(container.textContent).toContain("alice");
    root.unmount();
    container.remove();
  });
});

describe("SettingsUsersSection mutations", () => {
  it("adds a user and clears the form on success", async () => {
    const { mock, calls } = makeFetchMock([ALICE]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    const nameInput = container.querySelector<HTMLInputElement>("input[type='text']")!;
    const pwInput = container.querySelector<HTMLInputElement>("input[type='password']")!;
    await typeInto(nameInput, "carol");
    await typeInto(pwInput, "pw");
    await click(buttonByText(container, "Add"));
    expect(calls.some((c) => c.method === "POST" && c.body?.["username"] === "carol")).toBe(true);
    expect(nameInput.value).toBe("");
    root.unmount();
    container.remove();
  });

  it("maps server error codes to localized messages", async () => {
    const { mock } = makeFetchMock([ALICE], { status: 409, body: { error: "duplicate" } });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await typeInto(container.querySelector<HTMLInputElement>("input[type='text']")!, "alice");
    await typeInto(container.querySelector<HTMLInputElement>("input[type='password']")!, "pw");
    await click(buttonByText(container, "Add"));
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Username already exists.");
    root.unmount();
    container.remove();
  });
});

describe("SettingsUsersSection row actions", () => {
  it("changes a password through the inline editor", async () => {
    const { mock, calls } = makeFetchMock([ALICE, BOB]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(rowOf(container, "bob"), "Change password"));
    await typeInto(container.querySelector("input[type='password']")!, "new-pw");
    await click(buttonByText(container, "Save"));
    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.body?.["username"] === "bob" &&
          c.body?.["password"] === "new-pw",
      ),
    ).toBe(true);
    root.unmount();
    container.remove();
  });

  it("disables delete/disable for the current user and two-step deletes another", async () => {
    const { mock, calls } = makeFetchMock([ALICE, BOB]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    const aliceDelete = buttonByText(rowOf(container, "alice"), "Delete");
    expect(aliceDelete.disabled).toBe(true);
    await click(buttonByText(rowOf(container, "bob"), "Delete"));
    await click(buttonByText(rowOf(container, "bob"), "Confirm delete"));
    expect(calls.some((c) => c.method === "DELETE" && c.body?.["username"] === "bob")).toBe(true);
    root.unmount();
    container.remove();
  });

  it("reveals the TOTP secret after enabling and hides it on dismiss", async () => {
    const carol: AdminUser = { username: "carol", disabled: false, totp: false, current: false };
    const { mock, calls } = makeFetchMock([ALICE, carol], {
      status: 200,
      body: {
        user: { ...carol, totp: true },
        totpSecret: "JBSWY3DP",
        totpUri: "otpauth://totp/dsh-auth:carol?secret=JBSWY3DP",
      },
    });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(rowOf(container, "carol"), "Enable TOTP"));
    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" && c.body?.["username"] === "carol" && c.body?.["totp"] === "enable",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("JBSWY3DP");
    expect(container.textContent).toContain("otpauth://totp/dsh-auth:carol");
    await click(buttonByText(container, "Done"));
    expect(container.textContent).not.toContain("JBSWY3DP");
    root.unmount();
    container.remove();
  });
});
