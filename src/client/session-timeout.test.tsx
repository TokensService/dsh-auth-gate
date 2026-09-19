// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USERS_DICT_EN } from "./users-dict.ts";
import { SessionTimeoutPanel } from "./session-timeout.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string): string => USERS_DICT_EN[key] ?? key;

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: { method?: string; body?: string }) => Promise<unknown>>
>;

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

interface SettingsMockOptions {
  getStatus: number;
  patchStatus: number;
  sessionTtl: number;
  defaultTtl: number;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function jsonResponse(status: number, body: unknown): unknown {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function settingsResponse(
  method: string,
  parsed: Record<string, unknown> | undefined,
  options: SettingsMockOptions,
): unknown {
  if (method === "PATCH") {
    return options.patchStatus === 200
      ? { sessionTtl: parsed?.["sessionTtl"], defaultTtl: options.defaultTtl }
      : { error: "forbidden" };
  }
  return options.getStatus === 200
    ? { sessionTtl: options.sessionTtl, defaultTtl: options.defaultTtl }
    : { error: "unauthorized" };
}

/** 路由式 fetch mock：/auth/settings 的 GET 读 + PATCH 改（PATCH 回显请求值）。 */
function makeSettingsMock(overrides: Partial<SettingsMockOptions> = {}) {
  const options: SettingsMockOptions = {
    getStatus: 200,
    patchStatus: 200,
    sessionTtl: 604800,
    defaultTtl: 604800,
    ...overrides,
  };
  const calls: Call[] = [];
  const mock = vi.fn((url: string, init?: { method?: string; body?: string }): Promise<unknown> => {
    const method = init?.method ?? "GET";
    const parsed =
      init?.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({ url, method, ...(parsed === undefined ? {} : { body: parsed }) });
    const status = method === "PATCH" ? options.patchStatus : options.getStatus;
    return Promise.resolve(jsonResponse(status, settingsResponse(method, parsed, options)));
  });
  return { mock, calls };
}

async function renderPanel(isAdmin: boolean): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SessionTimeoutPanel, { tr: t, isAdmin }));
    await flushMicrotasks();
  });
  return { root, container };
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

describe("SessionTimeoutPanel (D16)", () => {
  it("shows the effective value with the default marker and prefilled hours", async () => {
    const { mock } = makeSettingsMock();
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    expect(container.textContent).toContain("Login timeout");
    expect(container.textContent).toContain("168 hours (7 days)");
    expect(container.textContent).toContain("(default)");
    expect(container.querySelector<HTMLInputElement>("input[type='number']")?.value).toBe("168");
    root.unmount();
    container.remove();
  });

  it("saves a new timeout in hours (the API receives seconds)", async () => {
    const { mock, calls } = makeSettingsMock();
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    await typeInto(container.querySelector<HTMLInputElement>("input[type='number']")!, "24");
    await click(buttonByText(container, "Save"));
    expect(
      calls.some(
        (c) =>
          c.url === "/auth/settings" && c.method === "PATCH" && c.body?.["sessionTtl"] === 86400,
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Saved.");
    expect(container.textContent).toContain("24 hours");
    root.unmount();
    container.remove();
  });
});

describe("SessionTimeoutPanel never-expiring option (D17)", () => {
  it("shows and saves the option as sessionTtl zero", async () => {
    const { mock, calls } = makeSettingsMock({ sessionTtl: 0, defaultTtl: 0 });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    const never = container.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    const hours = container.querySelector<HTMLInputElement>("input[type='number']")!;
    expect(container.textContent).toContain("Never expires");
    expect(never.checked).toBe(true);
    expect(hours.disabled).toBe(true);

    await click(never);
    expect(hours.disabled).toBe(false);
    await typeInto(hours, "24");
    await click(never);
    await click(buttonByText(container, "Save"));
    expect(
      calls.some(
        (c) => c.url === "/auth/settings" && c.method === "PATCH" && c.body?.["sessionTtl"] === 0,
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Effective now: Never expires");
    root.unmount();
    container.remove();
  });
});

describe("SessionTimeoutPanel validation and permissions (D16)", () => {
  it("rejects out-of-range hours locally without calling the API", async () => {
    const { mock, calls } = makeSettingsMock();
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    await typeInto(container.querySelector<HTMLInputElement>("input[type='number']")!, "0");
    await click(buttonByText(container, "Save"));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(container.textContent).toContain("Invalid timeout");
    root.unmount();
    container.remove();
  });

  it("maps a server rejection to the localized error", async () => {
    const { mock } = makeSettingsMock({ patchStatus: 403 });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    await typeInto(container.querySelector<HTMLInputElement>("input[type='number']")!, "48");
    await click(buttonByText(container, "Save"));
    expect(container.textContent).toContain("Permission denied: admins only.");
    root.unmount();
    container.remove();
  });

  it("renders read-only for non-admins (no input, no save button)", async () => {
    const { mock, calls } = makeSettingsMock();
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(false);
    expect(container.textContent).toContain("168 hours (7 days)");
    expect(container.querySelector("input[type='number']")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    root.unmount();
    container.remove();
  });

  it("shows a localized error when the settings load fails", async () => {
    const { mock } = makeSettingsMock({ getStatus: 401 });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderPanel(true);
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Session expired; refresh the page and sign in again.",
    );
    root.unmount();
    container.remove();
  });
});
