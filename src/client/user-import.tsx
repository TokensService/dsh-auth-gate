import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { SMALL_BUTTON_STYLE } from "./user-rows.tsx";
import {
  importUsersServerFile,
  importUsersText,
  listServerImportFiles,
  type ImportFailure,
  type ServerImportFile,
} from "./users-api.ts";
import { userErrorText } from "./users-dict.ts";
import {
  CONTROLS_STYLE,
  ERROR_STYLE,
  HINT_STYLE,
  LocalPicker,
  ModeToggle,
  readFileText,
  ServerPicker,
  type Mode,
  type Translate,
} from "./user-import-controls.tsx";

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "12px 0 0",
  borderTop: "0.5px solid var(--dsw-alias-border-l2)",
};

const LABEL_STYLE: CSSProperties = { fontSize: 14, fontWeight: 600, lineHeight: "20px" };

export interface ImportPanelProps {
  t: Translate;
  /** 导入成功后由父级刷新用户列表。 */
  onChanged: () => void;
}

/**
 * 批量导入面板（仅 admin 挂载，D14）：本地文件（浏览器读原文）或服务器
 * imports/ 目录内 txt 二选一，提交 /auth/users/import；全量校验，失败按行号
 * 列出明细（码本地化），成功显示导入条数。
 */
export function ImportPanel({ t, onChanged }: ImportPanelProps) {
  const s = useImport(onChanged);
  return (
    <div style={PANEL_STYLE}>
      <div>
        <div style={LABEL_STYLE}>{t("users.importTitle")}</div>
        <div style={HINT_STYLE}>{t("users.importHint")}</div>
      </div>
      <ModeToggle t={t} mode={s.mode} onSwitch={s.switchMode} />
      {s.mode === "local" ? (
        <LocalPicker t={t} fileName={s.localFile?.name ?? ""} onPick={s.pickLocal} />
      ) : (
        <ServerPicker
          t={t}
          files={s.serverFiles}
          selected={s.selected}
          onSelect={s.setSelected}
          onRefresh={() => void s.loadServerFiles()}
        />
      )}
      <div style={CONTROLS_STYLE}>
        <button
          type="button"
          style={SMALL_BUTTON_STYLE}
          disabled={!s.canSubmit}
          onClick={() => void s.submit()}
        >
          {t("users.importRun")}
        </button>
        {s.created !== null && (
          <span style={HINT_STYLE}>
            {t("users.importSuccess").replace("{n}", String(s.created))}
          </span>
        )}
      </div>
      <OutcomeBlock t={t} errorCode={s.errorCode} failures={s.failures} />
    </div>
  );
}

/** 失败/明细输出块（错误条 + 行号明细）。 */
function OutcomeBlock(props: { t: Translate; errorCode: string; failures: ImportFailure[] }) {
  const { t, errorCode, failures } = props;
  return (
    <>
      {errorCode !== "" && (
        <div style={ERROR_STYLE} role="alert">
          {userErrorText(t, errorCode)}
        </div>
      )}
      {failures.length > 0 && (
        <div style={ERROR_STYLE}>
          {t("users.importFailures")}
          {failures.map((failure) => (
            <div key={failure.line}>
              {t("users.importLine").replace("{line}", String(failure.line))}{" "}
              {failure.username === "" ? "" : `${failure.username}: `}
              {userErrorText(t, failure.code)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface ImportState {
  mode: Mode;
  localFile: File | null;
  serverFiles: ServerImportFile[] | null;
  selected: string;
  canSubmit: boolean;
  errorCode: string;
  failures: ImportFailure[];
  created: number | null;
  setSelected: (name: string) => void;
  switchMode: (mode: Mode) => void;
  pickLocal: (file: File | null) => void;
  loadServerFiles: () => Promise<void>;
  submit: () => Promise<void>;
}

/** 导入面板的全部状态与动作（模式切换/选择时重置输出）。 */
function useImport(onChanged: () => void): ImportState {
  const [mode, setMode] = useState<Mode>("local");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [serverFiles, setServerFiles] = useState<ServerImportFile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState("");
  const [failures, setFailures] = useState<ImportFailure[]>([]);
  const [created, setCreated] = useState<number | null>(null);

  const resetOutcome = useCallback(() => {
    setErrorCode("");
    setFailures([]);
    setCreated(null);
  }, []);

  const loadServerFiles = useCallback(async () => {
    const result = await listServerImportFiles();
    if (result.ok) {
      setServerFiles(result.files);
      setSelected((current) => (current === "" ? (result.files[0]?.name ?? "") : current));
    } else {
      setServerFiles([]);
      setErrorCode(result.code === "" ? "unknown" : result.code);
    }
  }, []);

  useEffect(() => {
    if (mode === "server" && serverFiles === null) void loadServerFiles();
  }, [mode, serverFiles, loadServerFiles]);

  const canSubmit = !busy && (mode === "local" ? localFile !== null : selected !== "");
  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    resetOutcome();
    try {
      const result =
        mode === "local"
          ? await importUsersText(await readFileText(localFile!))
          : await importUsersServerFile(selected);
      if (result.ok) {
        setCreated(result.created ?? 0);
        onChanged();
      } else {
        setErrorCode(result.code === "" ? "unknown" : result.code);
        setFailures(result.failures ?? []);
      }
    } catch {
      setErrorCode("unknown");
    } finally {
      setBusy(false);
    }
  }, [canSubmit, mode, localFile, selected, resetOutcome, onChanged]);

  return {
    mode,
    localFile,
    serverFiles,
    selected,
    canSubmit,
    errorCode,
    failures,
    created,
    setSelected,
    switchMode: (next) => {
      setMode(next);
      resetOutcome();
    },
    pickLocal: (file) => {
      setLocalFile(file);
      resetOutcome();
    },
    loadServerFiles,
    submit,
  };
}
