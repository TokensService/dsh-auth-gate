import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { LogoutTranslate } from "./logout-action.tsx";
import { AddUserForm, UserRow } from "./user-rows.tsx";
import { ImportPanel } from "./user-import.tsx";
import { TotpReveal, type TotpRevealData } from "./totp-reveal.tsx";
import { SessionTimeoutPanel } from "./session-timeout.tsx";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  type AdminUser,
  type MutationResult,
} from "./users-api.ts";
import { userErrorText } from "./users-dict.ts";

type LoadState = "loading" | "unavailable" | "error" | "ready";

type Translate = (key: string) => string;

export interface SettingsUsersSectionProps {
  /** 注入的本地化 translate（locale seat，`auth` 词典）。 */
  t?: LogoutTranslate;
}

const WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "4px 0 24px",
  maxWidth: 640,
};

const TITLE_STYLE: CSSProperties = { fontSize: 18, fontWeight: 600, lineHeight: "26px" };

const SUB_STYLE: CSSProperties = { fontSize: 13, lineHeight: "20px", opacity: 0.72 };

const ERROR_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-state-error-primary)",
};

/**
 * 「用户管理」设置页（`settings.section` 槽，password 模式专用）：列出 users.yaml
 * 全部用户（管理员/禁用/TOTP/当前登录徽标），支持添加、改密、启停、TOTP 启停、删除。
 * 数据走同源 `/auth/users` 管理 API（会话自校验；token 模式 404 → 不可用提示）。
 * 权限（D13）：非 admin 只能改自己的密码，故隐藏添加表单与其他行的操作按钮，
 * 服务端对越权变更恒 403（UI 降级只是镜像，API 才是权威）。
 */
export function SettingsUsersSection({ t }: SettingsUsersSectionProps) {
  const tr = useCallback((key: string) => (typeof t === "function" ? t(key) : key), [t]);
  const [state, setState] = useState<LoadState>("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [errorCode, setErrorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<TotpRevealData | null>(null);

  const refresh = useCallback(async () => {
    const result = await listUsers();
    if (result.ok) {
      setUsers(result.users);
      setState("ready");
    } else {
      setState(result.status === 404 ? "unavailable" : "error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 变更统一入口：busy + 错误码 + 成功后刷新列表；返回值供表单清理/后续展示。 */
  const run = useCallback(
    async (action: () => Promise<MutationResult>): Promise<MutationResult> => {
      setBusy(true);
      setErrorCode("");
      const result = await action();
      setBusy(false);
      if (result.ok) {
        await refresh();
      } else {
        setErrorCode(result.code === "" ? "unknown" : result.code);
      }
      return result;
    },
    [refresh],
  );

  /** TOTP 启停：enable 额外展示一次性 secret（响应里只有这一次）。 */
  const handleTotp = useCallback(
    async (user: AdminUser): Promise<boolean> => {
      const result = await run(() =>
        updateUser({ username: user.username, totp: user.totp ? "disable" : "enable" }),
      );
      if (result.ok && result.totpSecret !== undefined && result.totpUri !== undefined) {
        setReveal({ username: user.username, secret: result.totpSecret, uri: result.totpUri });
      }
      return result.ok;
    },
    [run],
  );

  return (
    <div style={WRAP_STYLE}>
      <div>
        <div style={TITLE_STYLE}>{tr("users.title")}</div>
        <div style={SUB_STYLE}>{tr("users.subtitle")}</div>
      </div>
      {state === "ready" ? (
        <ReadyPanel
          tr={tr}
          users={users}
          isAdmin={users.find((user) => user.current)?.admin === true}
          errorCode={errorCode}
          reveal={reveal}
          busy={busy}
          onDismissReveal={() => setReveal(null)}
          onChanged={() => void refresh()}
          onAdd={(u, p) => run(() => createUser(u, p)).then((r) => r.ok)}
          onPassword={(u, p) =>
            run(() => updateUser({ username: u, password: p })).then((r) => r.ok)
          }
          onToggleDisabled={(u) =>
            run(() => updateUser({ username: u.username, disabled: !u.disabled })).then((r) => r.ok)
          }
          onDelete={(u) => run(() => deleteUser(u)).then((r) => r.ok)}
          onTotp={handleTotp}
        />
      ) : (
        <SectionState state={state} t={tr} onRetry={() => void refresh()} />
      )}
    </div>
  );
}

interface ReadyPanelProps {
  tr: Translate;
  users: AdminUser[];
  /** 当前登录用户是否为 admin（决定添加表单/行内管理按钮是否出现）。 */
  isAdmin: boolean;
  errorCode: string;
  reveal: TotpRevealData | null;
  busy: boolean;
  onDismissReveal: () => void;
  onChanged: () => void;
  onAdd: (username: string, password: string) => Promise<boolean>;
  onPassword: (username: string, password: string) => Promise<boolean>;
  onToggleDisabled: (user: AdminUser) => Promise<boolean>;
  onDelete: (username: string) => Promise<boolean>;
  onTotp: (user: AdminUser) => Promise<boolean>;
}

/** ready 态主体：错误条 + TOTP 展示块 + 用户行列表 + 添加/导入表单（仅 admin）+ 脚注。 */
function ReadyPanel(props: ReadyPanelProps) {
  const { tr, users, isAdmin, errorCode, reveal, busy } = props;
  return (
    <>
      {errorCode !== "" && (
        <div style={ERROR_STYLE} role="alert">
          {userErrorText(tr, errorCode)}
        </div>
      )}
      {reveal !== null && <TotpReveal reveal={reveal} t={tr} onDismiss={props.onDismissReveal} />}
      <SessionTimeoutPanel tr={tr} isAdmin={isAdmin} />
      {users.length === 0 ? (
        <div style={SUB_STYLE}>{tr("users.empty")}</div>
      ) : (
        <div>
          {users.map((user) => (
            <UserRow
              key={user.username}
              user={user}
              t={tr}
              isAdmin={isAdmin}
              busy={busy}
              onPassword={props.onPassword}
              onToggleDisabled={props.onToggleDisabled}
              onTotp={props.onTotp}
              onDelete={props.onDelete}
            />
          ))}
        </div>
      )}
      {isAdmin && <AddUserForm t={tr} busy={busy} onAdd={props.onAdd} />}
      {isAdmin && <ImportPanel t={tr} onChanged={props.onChanged} />}
      <div style={SUB_STYLE}>{tr(isAdmin ? "users.note" : "users.noteNonAdmin")}</div>
    </>
  );
}

/** 非 ready 三态：加载中 / token 模式不可用 / 加载失败（可重试）。 */
function SectionState(props: { state: LoadState; t: Translate; onRetry: () => void }) {
  const { state, t } = props;
  if (state === "loading") return <div style={SUB_STYLE}>{t("users.loading")}</div>;
  if (state === "unavailable") return <div style={SUB_STYLE}>{t("users.unavailable")}</div>;
  return (
    <div style={SUB_STYLE}>
      {t("users.loadError")}{" "}
      <button type="button" style={{ textDecoration: "underline" }} onClick={props.onRetry}>
        {t("users.retry")}
      </button>
    </div>
  );
}
