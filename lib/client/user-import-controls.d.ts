import type { CSSProperties } from "react";
import type { ServerImportFile } from "./users-api.ts";
export type Translate = (key: string) => string;
export type Mode = "local" | "server";
export declare const CONTROLS_STYLE: CSSProperties;
export declare const HINT_STYLE: CSSProperties;
export declare const ERROR_STYLE: CSSProperties;
/** 本地/服务器模式切换（小按钮组，当前模式加粗）。 */
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
/** 服务端 imports/ 目录文件选择（列表由 GET /auth/users/import 提供）。 */
export declare function ServerPicker(props: {
    t: Translate;
    files: ServerImportFile[] | null;
    selected: string;
    onSelect: (name: string) => void;
    onRefresh: () => void;
}): import("react").JSX.Element;
/** FileReader 读全文（jsdom/浏览器兼容最好的路径）。 */
export declare function readFileText(file: File): Promise<string>;
//# sourceMappingURL=user-import-controls.d.ts.map