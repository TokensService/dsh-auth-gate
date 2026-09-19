type Translate = (key: string) => string;
export interface SessionTimeoutPanelProps {
    tr: Translate;
    /** 当前登录用户是否 admin：非 admin 只读展示当前值（PATCH 服务端恒 403，UI 只是镜像）。 */
    isAdmin: boolean;
}
/**
 * 登录超时设置块（D16，用户管理页内）：展示生效中的会话 TTL（+ 默认值标记），
 * admin 可按整小时修改（写 settings.yaml，只影响之后的新登录）；非 admin 只读。
 */
export declare function SessionTimeoutPanel({ tr, isAdmin }: SessionTimeoutPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=session-timeout.d.ts.map