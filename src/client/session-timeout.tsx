import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { SMALL_BUTTON_STYLE } from "./user-rows.tsx";
import { getSessionSettings, updateSessionTtl } from "./users-api.ts";
import { userErrorText } from "./users-dict.ts";

const SECONDS_PER_HOUR = 3600;
/** 页面可设上限（小时，= 1 年）；服务端合法域更宽（1 分钟起），页面取整时子集即可。 */
const MAX_HOURS = 8760;

type LoadState = "loading" | "ready" | "error";

type Translate = (key: string) => string;

export interface SessionTimeoutPanelProps {
  tr: Translate;
  /** 当前登录用户是否 admin：非 admin 只读展示当前值（PATCH 服务端恒 403，UI 只是镜像）。 */
  isAdmin: boolean;
}

const TITLE_STYLE: CSSProperties = { fontSize: 15, fontWeight: 600, lineHeight: "22px" };

const HINT_STYLE: CSSProperties = { fontSize: 13, lineHeight: "20px", opacity: 0.72 };

const ERROR_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: "20px",
  color: "var(--dsw-alias-state-error-primary)",
};

const ROW_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
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
  width: 110,
};

/** 生效值人性化：≥2 整天 → "{h} 小时（{d} 天）"，整时 → "{h} 小时"（英文单复数分键），其余 → "{s} 秒"。 */
function formatTtl(tr: Translate, seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 172800) {
    return tr("users.ttlValueDays")
      .replace("{h}", String(seconds / SECONDS_PER_HOUR))
      .replace("{d}", String(seconds / 86400));
  }
  if (seconds % SECONDS_PER_HOUR === 0) {
    const hours = seconds / SECONDS_PER_HOUR;
    return tr(hours === 1 ? "users.ttlValueHoursOne" : "users.ttlValueHours").replace(
      "{h}",
      String(hours),
    );
  }
  return tr("users.ttlValueSeconds").replace("{s}", String(seconds));
}

/**
 * 登录超时设置块（D16，用户管理页内）：展示生效中的会话 TTL（+ 默认值标记），
 * admin 可按整小时修改（写 settings.yaml，只影响之后的新登录）；非 admin 只读。
 */
export function SessionTimeoutPanel({ tr, isAdmin }: SessionTimeoutPanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [sessionTtl, setSessionTtl] = useState(0);
  const [defaultTtl, setDefaultTtl] = useState(0);
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSessionSettings().then((result) => {
      if (result.ok && result.sessionTtl !== undefined && result.defaultTtl !== undefined) {
        setSessionTtl(result.sessionTtl);
        setDefaultTtl(result.defaultTtl);
        setHours(String(Math.round(result.sessionTtl / SECONDS_PER_HOUR)));
        setState("ready");
      } else {
        setErrorCode(result.code === "" ? "unknown" : result.code);
        setState("error");
      }
    });
  }, []);

  const save = useCallback(async () => {
    const value = Number(hours);
    setSaved(false);
    if (!Number.isInteger(value) || value < 1 || value > MAX_HOURS) {
      setErrorCode("invalid_ttl");
      return;
    }
    setBusy(true);
    setErrorCode("");
    const result = await updateSessionTtl(value * SECONDS_PER_HOUR);
    setBusy(false);
    if (result.ok) {
      setSessionTtl(value * SECONDS_PER_HOUR);
      setSaved(true);
    } else {
      setErrorCode(result.code === "" ? "unknown" : result.code);
    }
  }, [hours]);

  if (state === "loading") return <div style={HINT_STYLE}>{tr("users.loading")}</div>;
  if (state === "error") {
    return (
      <div style={ERROR_STYLE} role="alert">
        {userErrorText(tr, errorCode)}
      </div>
    );
  }
  return (
    <ReadyBody
      tr={tr}
      isAdmin={isAdmin}
      sessionTtl={sessionTtl}
      defaultTtl={defaultTtl}
      hours={hours}
      busy={busy}
      errorCode={errorCode}
      saved={saved}
      onHours={(value) => {
        setHours(value);
        setSaved(false);
      }}
      onSave={() => void save()}
    />
  );
}

interface ReadyBodyProps {
  tr: Translate;
  isAdmin: boolean;
  sessionTtl: number;
  defaultTtl: number;
  hours: string;
  busy: boolean;
  errorCode: string;
  saved: boolean;
  onHours: (value: string) => void;
  onSave: () => void;
}

/** ready 态主体：当前生效值（+ 默认标记）+ admin 编辑行 + 保存反馈/错误条。 */
function ReadyBody(props: ReadyBodyProps) {
  const { tr, isAdmin } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={TITLE_STYLE}>{tr("users.ttlTitle")}</div>
      <div style={HINT_STYLE}>{tr("users.ttlHint")}</div>
      <div style={HINT_STYLE}>
        {tr("users.ttlCurrent").replace("{v}", formatTtl(tr, props.sessionTtl))}
        {props.sessionTtl === props.defaultTtl ? tr("users.ttlDefaultMark") : ""}
      </div>
      {isAdmin && (
        <div style={ROW_STYLE}>
          <input
            type="number"
            style={INPUT_STYLE}
            min={1}
            max={MAX_HOURS}
            aria-label={tr("users.ttlTitle")}
            value={props.hours}
            disabled={props.busy}
            onChange={(event) => props.onHours(event.target.value)}
          />
          <span style={HINT_STYLE}>{tr("users.ttlHours")}</span>
          <button
            type="button"
            style={SMALL_BUTTON_STYLE}
            disabled={props.busy}
            onClick={props.onSave}
          >
            {tr("users.save")}
          </button>
          {props.saved && <span style={HINT_STYLE}>{tr("users.ttlSaved")}</span>}
        </div>
      )}
      {isAdmin && <div style={HINT_STYLE}>{tr("users.ttlRange")}</div>}
      {props.errorCode !== "" && (
        <div style={ERROR_STYLE} role="alert">
          {userErrorText(tr, props.errorCode)}
        </div>
      )}
    </div>
  );
}
