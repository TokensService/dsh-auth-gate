import type { CSSProperties } from "react";
import { SMALL_BUTTON_STYLE } from "./user-rows.tsx";
import type { ServerImportFile } from "./users-api.ts";

export type Translate = (key: string) => string;

export type Mode = "local" | "server";

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

const SELECT_STYLE: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: "18px",
};

/** 本地/服务器模式切换（小按钮组，当前模式加粗）。 */
export function ModeToggle(props: { t: Translate; mode: Mode; onSwitch: (mode: Mode) => void }) {
  const { t, mode } = props;
  const buttonStyle = (active: boolean): CSSProperties => ({
    ...SMALL_BUTTON_STYLE,
    fontWeight: active ? 600 : 400,
    opacity: active ? 1 : 0.72,
  });
  return (
    <div style={CONTROLS_STYLE}>
      <button
        type="button"
        style={buttonStyle(mode === "local")}
        aria-pressed={mode === "local"}
        onClick={() => props.onSwitch("local")}
      >
        {t("users.importModeLocal")}
      </button>
      <button
        type="button"
        style={buttonStyle(mode === "server")}
        aria-pressed={mode === "server"}
        onClick={() => props.onSwitch("server")}
      >
        {t("users.importModeServer")}
      </button>
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

/** 服务端 imports/ 目录文件选择（列表由 GET /auth/users/import 提供）。 */
export function ServerPicker(props: {
  t: Translate;
  files: ServerImportFile[] | null;
  selected: string;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}) {
  const { t, files, selected } = props;
  if (files === null) {
    return (
      <div style={CONTROLS_STYLE}>
        <span style={HINT_STYLE}>{t("users.loading")}</span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div style={CONTROLS_STYLE}>
        <span style={HINT_STYLE}>{t("users.importNoServerFiles")}</span>
        <button type="button" style={SMALL_BUTTON_STYLE} onClick={props.onRefresh}>
          {t("users.importRefresh")}
        </button>
      </div>
    );
  }
  return (
    <div style={CONTROLS_STYLE}>
      <select
        style={SELECT_STYLE}
        aria-label={t("users.importModeServer")}
        value={selected}
        onChange={(event) => props.onSelect(event.target.value)}
      >
        {files.map((file) => (
          <option key={file.name} value={file.name}>
            {file.name} ({file.size} B)
          </option>
        ))}
      </select>
      <button type="button" style={SMALL_BUTTON_STYLE} onClick={props.onRefresh}>
        {t("users.importRefresh")}
      </button>
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
