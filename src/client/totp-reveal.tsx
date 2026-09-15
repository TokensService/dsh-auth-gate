import type { CSSProperties } from "react";
import { SMALL_BUTTON_STYLE } from "./user-rows.tsx";

const REVEAL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--dsw-alias-border-l2)",
};

const CODE_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: "18px",
  wordBreak: "break-all",
  userSelect: "all",
};

const HINT_STYLE: CSSProperties = { fontSize: 12, lineHeight: "18px", opacity: 0.72 };

/** TOTP 启用成功后一次性展示的 secret 数据（host 只在响应里回这一次）。 */
export interface TotpRevealData {
  username: string;
  secret: string;
  uri: string;
}

/** TOTP secret 一次性展示块（base32 + otpauth URI，手动录入认证器）。 */
export function TotpReveal(props: {
  reveal: TotpRevealData;
  t: (key: string) => string;
  onDismiss: () => void;
}) {
  const { reveal, t } = props;
  return (
    <div style={REVEAL_STYLE}>
      <div>
        {t("users.totpSecretTitle")}: {reveal.username}
      </div>
      <code style={CODE_STYLE}>{reveal.secret}</code>
      <code style={CODE_STYLE}>{reveal.uri}</code>
      <div style={HINT_STYLE}>{t("users.totpSecretHint")}</div>
      <button
        type="button"
        style={{ ...SMALL_BUTTON_STYLE, alignSelf: "flex-start" }}
        onClick={props.onDismiss}
      >
        {t("users.dismiss")}
      </button>
    </div>
  );
}
