import { useState, type CSSProperties, type FormEvent } from "react";
import type { AdminUser } from "./users-api.ts";

/** 行内小按钮（主题变量描边，不硬编码色值）。 */
export const SMALL_BUTTON_STYLE: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: "18px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const INPUT_STYLE: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: "18px",
  minWidth: 0,
};

const ROW_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  padding: "10px 0",
  borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
};

const NAME_STYLE: CSSProperties = { fontSize: 14, fontWeight: 500, marginRight: 4 };

const BADGE_STYLE: CSSProperties = {
  padding: "1px 8px",
  borderRadius: 999,
  border: "1px solid var(--dsw-alias-border-l2)",
  fontSize: 12,
  lineHeight: "18px",
  opacity: 0.72,
};

const ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginLeft: "auto",
};

const FORM_ROW_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  flexBasis: "100%",
};

type Translate = (key: string) => string;

export interface UserRowProps {
  user: AdminUser;
  t: Translate;
  busy: boolean;
  onPassword: (username: string, password: string) => Promise<boolean>;
  onToggleDisabled: (user: AdminUser) => Promise<boolean>;
  onTotp: (user: AdminUser) => Promise<boolean>;
  onDelete: (username: string) => Promise<boolean>;
}

/** 单个用户行：状态徽标 + 改密内联表单 + 启停/TOTP/删除（删除两步确认）。 */
export function UserRow(props: UserRowProps) {
  const { user, t, busy } = props;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={ROW_STYLE}>
      <span style={NAME_STYLE}>{user.username}</span>
      {user.current && <span style={BADGE_STYLE}>{t("users.you")}</span>}
      {user.disabled && <span style={BADGE_STYLE}>{t("users.disabled")}</span>}
      {user.totp && <span style={BADGE_STYLE}>{t("users.totpOn")}</span>}
      <span style={ACTIONS_STYLE}>
        <button
          type="button"
          style={SMALL_BUTTON_STYLE}
          disabled={busy}
          onClick={() => setEditing((open) => !open)}
        >
          {t("users.changePassword")}
        </button>
        <button
          type="button"
          style={SMALL_BUTTON_STYLE}
          disabled={busy || user.current}
          onClick={() => void props.onToggleDisabled(user)}
        >
          {user.disabled ? t("users.enable") : t("users.disable")}
        </button>
        <button
          type="button"
          style={SMALL_BUTTON_STYLE}
          disabled={busy}
          onClick={() => void props.onTotp(user)}
        >
          {user.totp ? t("users.totpDisable") : t("users.totpEnable")}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              style={SMALL_BUTTON_STYLE}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void props.onDelete(user.username);
              }}
            >
              {t("users.confirmDelete")}
            </button>
            <button type="button" style={SMALL_BUTTON_STYLE} onClick={() => setConfirming(false)}>
              {t("users.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            style={SMALL_BUTTON_STYLE}
            disabled={busy || user.current}
            onClick={() => setConfirming(true)}
          >
            {t("users.delete")}
          </button>
        )}
      </span>
      {editing && (
        <PasswordEditor
          t={t}
          busy={busy}
          onSave={async (password) => {
            const ok = await props.onPassword(user.username, password);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      )}
    </div>
  );
}

/** 改密内联表单（成功由父级关闭）。 */
function PasswordEditor(props: {
  t: Translate;
  busy: boolean;
  onSave: (password: string) => Promise<boolean>;
}) {
  const { t, busy } = props;
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password !== "") void props.onSave(password);
  };
  return (
    <form style={FORM_ROW_STYLE} onSubmit={submit}>
      <input
        type="password"
        style={INPUT_STYLE}
        placeholder={t("users.newPassword")}
        aria-label={t("users.newPassword")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" style={SMALL_BUTTON_STYLE} disabled={busy || password === ""}>
        {t("users.save")}
      </button>
    </form>
  );
}

export interface AddUserFormProps {
  t: Translate;
  busy: boolean;
  onAdd: (username: string, password: string) => Promise<boolean>;
}

/** 添加用户表单（成功后清空输入）。 */
export function AddUserForm({ t, busy, onAdd }: AddUserFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void onAdd(username, password).then((ok) => {
      if (ok) {
        setUsername("");
        setPassword("");
      }
    });
  };
  return (
    <form style={FORM_ROW_STYLE} onSubmit={submit}>
      <input
        type="text"
        style={INPUT_STYLE}
        placeholder={t("users.username")}
        aria-label={t("users.username")}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <input
        type="password"
        style={INPUT_STYLE}
        placeholder={t("users.password")}
        aria-label={t("users.password")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button
        type="submit"
        style={SMALL_BUTTON_STYLE}
        disabled={busy || username === "" || password === ""}
      >
        {t("users.add")}
      </button>
    </form>
  );
}
