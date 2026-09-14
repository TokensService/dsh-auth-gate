import { useEffect, useState, type CSSProperties } from "react";

/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
const LOGOUT_TARGET = "/auth/logout?next=/";

/**
 * 登出图标：16px 按钮图标（viewBox 24 不变，只设 width/height 16）。
 * 沿用原 32px 圆形按钮的同一个 SVG（方框 + 箭头）。
 */
function renderLogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/**
 * 设置面板内醒目的登出 CTA：错误强调色（危险动作语义）填充按钮 +
 * 反色标签 `--dsw-alias-label-primary-inverted`，面板内水平居中（General 页底部）。
 */
const CTA_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 24px",
  borderRadius: 12,
  border: "1px solid var(--dsw-alias-state-error-primary)",
  background: "var(--dsw-alias-state-error-primary)",
  color: "var(--dsw-alias-label-primary-inverted)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: "22px",
  cursor: "pointer",
};

/** hover 态轻微提亮（随主题自适应，不硬编码色值）。 */
const CTA_HOVER_FILTER = "brightness(1.08)";

/** 用户名行：按钮上方居中，弱化的小字（随主题，不硬编码色值）。 */
const USERNAME_STYLE: CSSProperties = {
  marginBottom: 12,
  fontSize: 13,
  lineHeight: "20px",
  opacity: 0.72,
};

/** 面板内水平居中容器（General 页最后一条行之后）；用户名行 + CTA 纵向堆叠。 */
const CTA_WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "20px 0 4px",
};

const formStyle: CSSProperties = {
  display: "contents",
};

/** /auth/status 的会话面：authenticated 与当前登录用户名（token 模式恒 null）。 */
interface SessionStatus {
  authenticated: boolean;
  username: string | null;
}

/**
 * 会话状态门控：挂载时 fetch /auth/status 一次（只认 cookie）。
 * @returns null = 未知（第一次请求前），否则 authenticated + username。
 */
function useSessionStatus(): SessionStatus | null {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/status")
      .then((res) => res.json())
      .then((body: { authenticated?: unknown; username?: unknown }) => {
        if (cancelled) return;
        setStatus({
          authenticated: body.authenticated === true,
          username:
            typeof body.username === "string" && body.username !== "" ? body.username : null,
        });
      })
      .catch(() => {
        if (!cancelled) setStatus({ authenticated: false, username: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

/** 槽位渲染器按注册 `locale` 注入的 translate 形（本插件 `auth` 词典的 `logout` 键）。 */
export type LogoutTranslate = (key: string, params?: Record<string, unknown>) => string;

/** 设置面板里的登出按钮组件（`settings.general.item` 槽，root 作用域）。 */
export interface SettingsLogoutActionProps {
  /** 注入的本地化 translate（locale seat）。 */
  t?: LogoutTranslate;
}

/**
 * 可复用的登出提交按钮：原生 form POST（零 JS 依赖）+ 16px 方块图标 + 本地化文字。
 * 渲染进 `settings.general.item`（设置 → 通用设置 的追加行槽，order 30 → 页面底部），
 * 水平居中的醒目 CTA；文案随界面语言在「退出登录」/ "Sign out" 间切换。
 * 会话带用户名时（password 模式），按钮上方显示当前登录用户名。
 */
export function SettingsLogoutAction({ t }: SettingsLogoutActionProps) {
  const status = useSessionStatus();
  const [hovered, setHovered] = useState(false);
  if (status?.authenticated !== true) return null;
  const label = typeof t === "function" ? t("logout") : "Sign out";
  const signedInAs = typeof t === "function" ? t("signedInAs") : "Signed in as";
  return (
    <form method="post" action={LOGOUT_TARGET} style={formStyle}>
      <div style={CTA_WRAP_STYLE}>
        {status.username !== null && (
          <div style={USERNAME_STYLE}>
            {signedInAs}: {status.username}
          </div>
        )}
        <button
          type="submit"
          aria-label={label}
          title={label}
          style={{
            ...CTA_STYLE,
            filter: hovered ? CTA_HOVER_FILTER : undefined,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {renderLogoutIcon()}
          {label}
        </button>
      </div>
    </form>
  );
}
