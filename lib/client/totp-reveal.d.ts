/** TOTP 启用成功后一次性展示的 secret 数据（host 只在响应里回这一次）。 */
export interface TotpRevealData {
    username: string;
    secret: string;
    uri: string;
}
/** TOTP secret 一次性展示块（base32 + otpauth URI，手动录入认证器）。 */
export declare function TotpReveal(props: {
    reveal: TotpRevealData;
    t: (key: string) => string;
    onDismiss: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=totp-reveal.d.ts.map