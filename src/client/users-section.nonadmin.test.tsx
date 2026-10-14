// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
import { USERS_DICT_EN } from "./users-dict.ts";
import {
  buttonByText,
  click,
  makeFetchMock,
  renderSection,
  rowOf,
  typeInto,
  type FetchMock,
} from "./users-section-helpers.tsx";

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
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
    expect(container.textContent).toContain("Login timeout");
    expect(container.textContent).toContain("168 hours (7 days)");
    expect(container.querySelector("input[type='number']")).toBeNull();
    root.unmount();
    container.remove();
  });
});
