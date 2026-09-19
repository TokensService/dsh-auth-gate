import type { CSSProperties } from "react";
export type Translate = (key: string) => string;
export type Mode = "local" | "path";
export declare const CONTROLS_STYLE: CSSProperties;
export declare const HINT_STYLE: CSSProperties;
export declare const ERROR_STYLE: CSSProperties;
/** 本地/服务器路径模式切换（小按钮组，当前模式加粗）。 */
export declare function ModeToggle(props: {
    t: Translate;
    mode: Mode;
    onSwitch: (mode: Mode) => void;
}): import("react").JSX.Element;
/** 本地文件选择（浏览器 FileReader 读原文，不接触服务器文件系统）。 */
export declare function LocalPicker(props: {
    t: Translate;
    fileName: string;
    onPick: (file: File | null) => void;
}): import("react").JSX.Element;
/** 服务端任意路径输入（D15）：`.txt` 绝对路径，host 侧仍做 404/413 收口。 */
export declare function PathPicker(props: {
    t: Translate;
    value: string;
    onChange: (value: string) => void;
}): import("react").JSX.Element;
/** FileReader 读全文（jsdom/浏览器兼容最好的路径）。 */
export declare function readFileText(file: File): Promise<string>;
//# sourceMappingURL=user-import-controls.d.ts.map