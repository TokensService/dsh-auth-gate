// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "./users-api.ts";
import { USERS_DICT_EN } from "./users-dict.ts";
import {
  buttonByText,
  click,
  jsonResponse,
  makeFetchMock,
  renderSection,
  rowOf,
  typeInto,
  type FetchMock,
} from "./users-section-helpers.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string): string => USERS_DICT_EN[key] ?? key;

const ALICE: AdminUser = {
  username: "alice",
  disabled: false,
  totp: false,
  admin: true,
  current: true,
};
const BOB: AdminUser = {
  username: "bob",
  disabled: true,
  totp: true,
  admin: false,
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

describe("SettingsUsersSection states", () => {
  it("lists users with status badges after loading", async () => {
    const { mock } = makeFetchMock([ALICE, BOB]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
    expect(container.textContent).toContain("unavailable in token mode");
    root.unmount();
    container.remove();
  });

  it("shows a retryable error when the list fails to load", async () => {
    const { mock } = makeFetchMock([ALICE]);
    fetchMock.mockImplementation(mock);
    fetchMock.mockRejectedValueOnce(new Error("network")); // 仅首次 GET 失败
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
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
    const { root, container } = await renderSection(t);
    await click(buttonByText(rowOf(container, "bob"), "Change password"));
    await typeInto(container.querySelector("input[type='password']")!, "new-pw");
    await click(buttonByText(rowOf(container, "bob"), "Save"));
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
    const { root, container } = await renderSection(t);
    const aliceDelete = buttonByText(rowOf(container, "alice"), "Delete");
    expect(aliceDelete.disabled).toBe(true);
    await click(buttonByText(rowOf(container, "bob"), "Delete"));
    await click(buttonByText(rowOf(container, "bob"), "Confirm delete"));
    expect(calls.some((c) => c.method === "DELETE" && c.body?.["username"] === "bob")).toBe(true);
    root.unmount();
    container.remove();
  });

  it("reveals the TOTP secret after enabling and hides it on dismiss", async () => {
    const carol: AdminUser = {
      username: "carol",
      disabled: false,
      totp: false,
      admin: false,
      current: false,
    };
    const { mock, calls } = makeFetchMock([ALICE, carol], {
      status: 200,
      body: {
        user: { ...carol, totp: true },
        totpSecret: "JBSWY3DP",
        totpUri: "otpauth://totp/dsh-auth:carol?secret=JBSWY3DP",
      },
    });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection(t);
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

describe("SettingsUsersSection admin role actions (D18)", () => {
  it("grants and revokes the role from row actions; the self toggle stays disabled", async () => {
    const carolAdmin: AdminUser = {
      username: "carol",
      disabled: false,
      totp: false,
      admin: true,
      current: false,
    };
    const { mock, calls } = makeFetchMock([ALICE, BOB, carolAdmin]);
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection(t);
    expect(buttonByText(rowOf(container, "alice"), "Remove admin").disabled).toBe(true);
    await click(buttonByText(rowOf(container, "bob"), "Make admin"));
    await click(buttonByText(rowOf(container, "carol"), "Remove admin"));
    expect(
      calls.some(
        (c) => c.method === "PATCH" && c.body?.["username"] === "bob" && c.body?.["admin"] === true,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" && c.body?.["username"] === "carol" && c.body?.["admin"] === false,
      ),
    ).toBe(true);
    root.unmount();
    container.remove();
  });

  it("localizes the self_target error returned by a demotion attempt", async () => {
    const { mock } = makeFetchMock([ALICE, BOB], { status: 409, body: { error: "self_target" } });
    fetchMock.mockImplementation(mock);
    const { root, container } = await renderSection(t);
    await click(buttonByText(rowOf(container, "bob"), "Make admin"));
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Cannot disable, delete, or demote the signed-in user.",
    );
    root.unmount();
    container.remove();
  });
});
