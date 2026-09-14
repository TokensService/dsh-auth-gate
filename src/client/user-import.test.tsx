// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser, ServerImportFile } from "./users-api.ts";
import { USERS_DICT_EN } from "./users-dict.ts";
import { SettingsUsersSection } from "./users-section.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string): string => USERS_DICT_EN[key] ?? key;

const ALICE: AdminUser = {
  username: "alice",
  disabled: false,
  totp: false,
  admin: true,
  current: true,
};
const CAROL_NONADMIN: AdminUser = {
  username: "carol",
  disabled: false,
  totp: false,
  admin: false,
  current: true,
};

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: { method?: string; body?: string }) => Promise<unknown>>
>;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

/** 路由式 fetch mock：/auth/users 列表 + /auth/users/import 列表与导入。 */
function makeFetchMock(options: {
  users: AdminUser[];
  files?: ServerImportFile[];
  importResult?: { status: number; body: unknown };
}) {
  const calls: Call[] = [];
  const mock = vi.fn((url: string, init?: { method?: string; body?: string }): Promise<unknown> => {
    const method = init?.method ?? "GET";
    const parsed =
      init?.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({ url, method, ...(parsed === undefined ? {} : { body: parsed }) });
    if (url === "/auth/users/import") {
      if (method === "GET")
        return Promise.resolve(jsonResponse(200, { files: options.files ?? [] }));
      const result = options.importResult ?? { status: 201, body: { created: 2 } };
      return Promise.resolve(jsonResponse(result.status, result.body));
    }
    return Promise.resolve(jsonResponse(200, { users: options.users }));
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

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
  });
}

/** 模拟文件选择（input.files 只读，defineProperty 注入 + change 事件）。 */
async function pickFile(input: HTMLInputElement, file: File): Promise<void> {
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("SettingsUsersSection import panel visibility (D14)", () => {
  it("is visible for admins and hidden for non-admins", async () => {
    const admin = makeFetchMock({ users: [ALICE] });
    fetchMock.mockImplementation(admin.mock);
    const { root, container } = await renderSection();
    expect(container.textContent).toContain("Batch import (txt)");
    root.unmount();
    container.remove();

    const nonAdmin = makeFetchMock({ users: [CAROL_NONADMIN] });
    fetchMock.mockImplementation(nonAdmin.mock);
    const second = await renderSection();
    expect(second.container.textContent).not.toContain("Batch import (txt)");
    second.root.unmount();
    second.container.remove();
  });

  it("shows the empty hint when the server imports dir has no txt", async () => {
    const { mock } = makeFetchMock({ users: [ALICE], files: [] });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(container, "Server file"));
    expect(container.textContent).toContain(
      "No .txt files in the server's imports/ directory yet.",
    );
    root.unmount();
    container.remove();
  });
});

describe("SettingsUsersSection import flows (D14)", () => {
  it("imports a local txt file (raw text goes to the API)", async () => {
    const { mock, calls } = makeFetchMock({ users: [ALICE] });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    const input = container.querySelector<HTMLInputElement>("input[type='file']")!;
    await pickFile(input, new File(["carol,pw-c\ndave,pw-d\n"], "users.txt"));
    await click(buttonByText(container, "Import"));
    expect(
      calls.some(
        (c) =>
          c.url === "/auth/users/import" &&
          c.method === "POST" &&
          typeof c.body?.["text"] === "string" &&
          c.body["text"].includes("carol,pw-c"),
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Imported 2 users.");
    root.unmount();
    container.remove();
  });

  it("lists server files in server mode and imports the selected one", async () => {
    const { mock, calls } = makeFetchMock({
      users: [ALICE],
      files: [{ name: "team.txt", size: 10 }],
    });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    await click(buttonByText(container, "Server file"));
    expect(calls.some((c) => c.url === "/auth/users/import" && c.method === "GET")).toBe(true);
    expect(container.textContent).toContain("team.txt (10 B)");
    await click(buttonByText(container, "Import"));
    expect(
      calls.some(
        (c) =>
          c.url === "/auth/users/import" && c.method === "POST" && c.body?.["file"] === "team.txt",
      ),
    ).toBe(true);
    root.unmount();
    container.remove();
  });

  it("renders per-line failures with localized reasons", async () => {
    const { mock } = makeFetchMock({
      users: [ALICE],
      importResult: {
        status: 400,
        body: {
          error: "invalid_entry",
          failures: [{ line: 2, username: "bad name", code: "invalid_username" }],
        },
      },
    });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection();
    const input = container.querySelector<HTMLInputElement>("input[type='file']")!;
    await pickFile(input, new File(["ok,pw\nbad name,x\n"], "users.txt"));
    await click(buttonByText(container, "Import"));
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The file contains invalid lines; nothing was imported (see below).",
    );
    expect(container.textContent).toContain(
      "line 2 bad name: Invalid username (start with a letter or digit; . _ - allowed).",
    );
    root.unmount();
    container.remove();
  });
});
