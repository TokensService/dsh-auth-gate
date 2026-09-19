import type { CSSProperties } from "react";
import { SMALL_BUTTON_STYLE } from "./user-rows.tsx";

export type Translate = (key: string) => string;

export type Mode = "local" | "path";

export const CONTROLS_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
};

export const HINT_STYLE: CSSProperties = { fontSize: 13, lineHeight: "20px", opacity: 0.72 };

export const ERROR_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-state-error-primary)",
};

const PATH_INPUT_STYLE: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: "18px",
  minWidth: 260,
  flex: "1 1 320px",
};

/** 本地/服务器路径模式切换（小按钮组，当前模式加粗）。 */
export function ModeToggle(props: { t: Translate; mode: Mode; onSwitch: (mode: Mode) => void }) {
  const { t, mode } = props;
  const buttonStyle = (active: boolean): CSSProperties => ({
    ...SMALL_BUTTON_STYLE,
    fontWeight: active ? 600 : 400,
    opacity: active ? 1 : 0.72,
  });
  const modes: { key: Mode; label: string }[] = [
    { key: "local", label: t("users.importModeLocal") },
    { key: "path", label: t("users.importModePath") },
  ];
  return (
    <div style={CONTROLS_STYLE}>
      {modes.map((item) => (
        <button
          key={item.key}
          type="button"
          style={buttonStyle(mode === item.key)}
          aria-pressed={mode === item.key}
          onClick={() => props.onSwitch(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 本地文件选择（浏览器 FileReader 读原文，不接触服务器文件系统）。 */
export function LocalPicker(props: {
  t: Translate;
  fileName: string;
  onPick: (file: File | null) => void;
}) {
  const { t, fileName } = props;
  return (
    <div style={CONTROLS_STYLE}>
      <input
        type="file"
        accept=".txt,text/plain"
        style={{ fontSize: 13, maxWidth: 260 }}
        aria-label={t("users.importChooseFile")}
        onChange={(event) => props.onPick(event.currentTarget.files?.[0] ?? null)}
      />
      {fileName !== "" && <span style={HINT_STYLE}>{fileName}</span>}
    </div>
  );
}

/** 服务端任意路径输入（D15）：`.txt` 绝对路径，host 侧仍做 404/413 收口。 */
export function PathPicker(props: {
  t: Translate;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t, value } = props;
  return (
    <div style={CONTROLS_STYLE}>
      <input
        type="text"
        style={PATH_INPUT_STYLE}
        placeholder="/srv/files/users.txt"
        aria-label={t("users.importPathLabel")}
        value={value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      <span style={HINT_STYLE}>{t("users.importPathHint")}</span>
    </div>
  );
}

/** FileReader 读全文（jsdom/浏览器兼容最好的路径）。 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsText(file);
  });
}
