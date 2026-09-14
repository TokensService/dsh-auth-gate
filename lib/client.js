window.__ModuleLoader__.load({
	id: "dsh-auth-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/logout-action.tsx
		/** 登出目标：POST-only（M22：next 仅从 query 取，校验回落 /）。 */
		const LOGOUT_TARGET = "/auth/logout?next=/";
		/**
		* 登出图标：16px 按钮图标（viewBox 24 不变，只设 width/height 16）。
		* 沿用原 32px 圆形按钮的同一个 SVG（方框 + 箭头）。
		*/
		function renderLogoutIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 24 24",
				width: 16,
				height: 16,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "16 17 21 12 16 7" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "21",
						y1: "12",
						x2: "9",
						y2: "12"
					})
				]
			});
		}
		/**
		* 设置面板内醒目的登出 CTA：错误强调色（危险动作语义）填充按钮 +
		* 反色标签 `--dsw-alias-label-primary-inverted`，面板内水平居中（General 页底部）。
		*/
		const CTA_STYLE = {
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
			cursor: "pointer"
		};
		/** hover 态轻微提亮（随主题自适应，不硬编码色值）。 */
		const CTA_HOVER_FILTER = "brightness(1.08)";
		/** 用户名行：按钮上方居中，弱化的小字（随主题，不硬编码色值）。 */
		const USERNAME_STYLE = {
			marginBottom: 12,
			fontSize: 13,
			lineHeight: "20px",
			opacity: .72
		};
		/** 面板内水平居中容器（General 页最后一条行之后）；用户名行 + CTA 纵向堆叠。 */
		const CTA_WRAP_STYLE = {
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			padding: "20px 0 4px"
		};
		const formStyle = { display: "contents" };
		/**
		* 会话状态门控：挂载时 fetch /auth/status 一次（只认 cookie）。
		* @returns null = 未知（第一次请求前），否则 authenticated + username。
		*/
		function useSessionStatus() {
			const [status, setStatus] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetch("/auth/status").then((res) => res.json()).then((body) => {
					if (cancelled) return;
					setStatus({
						authenticated: body.authenticated === true,
						username: typeof body.username === "string" && body.username !== "" ? body.username : null
					});
				}).catch(() => {
					if (!cancelled) setStatus({
						authenticated: false,
						username: null
					});
				});
				return () => {
					cancelled = true;
				};
			}, []);
			return status;
		}
		/**
		* 可复用的登出提交按钮：原生 form POST（零 JS 依赖）+ 16px 方块图标 + 本地化文字。
		* 渲染进 `settings.general.item`（设置 → 通用设置 的追加行槽，order 30 → 页面底部），
		* 水平居中的醒目 CTA；文案随界面语言在「退出登录」/ "Sign out" 间切换。
		* 会话带用户名时（password 模式），按钮上方显示当前登录用户名。
		*/
		function SettingsLogoutAction({ t }) {
			const status = useSessionStatus();
			const [hovered, setHovered] = (0, react.useState)(false);
			if (status?.authenticated !== true) return null;
			const label = typeof t === "function" ? t("logout") : "Sign out";
			const signedInAs = typeof t === "function" ? t("signedInAs") : "Signed in as";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("form", {
				method: "post",
				action: LOGOUT_TARGET,
				style: formStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: CTA_WRAP_STYLE,
					children: [status.username !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: USERNAME_STYLE,
						children: [
							signedInAs,
							": ",
							status.username
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "submit",
						"aria-label": label,
						title: label,
						style: {
							...CTA_STYLE,
							filter: hovered ? CTA_HOVER_FILTER : void 0
						},
						onMouseEnter: () => setHovered(true),
						onMouseLeave: () => setHovered(false),
						children: [renderLogoutIcon(), label]
					})]
				})
			});
		}
		//#endregion
		//#region src/client/users-dict.ts
		/**
		* 用户管理设置页的词典（`auth` 命名域，zh/en 成对）。
		* 错误文案按 host 稳定错误码命名（users.error.<code>），client 直接按码查表。
		*/
		const USERS_DICT_ZH = {
			"users.nav": "用户管理",
			"users.title": "用户管理",
			"users.subtitle": "管理 dsh-auth 的登录用户（users.yaml）",
			"users.loading": "加载中…",
			"users.unavailable": "当前为 token 模式，用户管理不可用（仅 password 模式支持）。",
			"users.loadError": "用户列表加载失败。",
			"users.retry": "重试",
			"users.you": "当前用户",
			"users.admin": "管理员",
			"users.disabled": "已禁用",
			"users.totpOn": "TOTP",
			"users.changePassword": "修改密码",
			"users.newPassword": "新密码",
			"users.save": "保存",
			"users.cancel": "取消",
			"users.enable": "启用",
			"users.disable": "禁用",
			"users.delete": "删除",
			"users.confirmDelete": "确认删除",
			"users.totpEnable": "启用 TOTP",
			"users.totpDisable": "停用 TOTP",
			"users.totpSecretTitle": "新 TOTP 密钥（只显示这一次）",
			"users.totpSecretHint": "把 base32 密钥或 otpauth 链接添加到认证器应用，然后用登录验证。",
			"users.dismiss": "知道了",
			"users.addTitle": "添加用户",
			"users.username": "用户名",
			"users.password": "密码",
			"users.add": "添加",
			"users.empty": "还没有用户。",
			"users.note": "禁用或删除只阻止新的登录；已签发的会话在过期前仍然有效。",
			"users.noteNonAdmin": "只有管理员可以添加或管理其他用户；你可以修改自己的密码。",
			"users.error.unauthorized": "会话已失效，请刷新页面重新登录。",
			"users.error.forbidden": "没有权限：仅管理员可执行此操作。",
			"users.error.duplicate": "用户名已存在。",
			"users.error.invalid_username": "用户名格式非法（字母或数字开头，可含 . _ -）。",
			"users.error.empty_password": "密码不能为空。",
			"users.error.not_found": "用户不存在。",
			"users.error.self_target": "不能禁用或删除当前登录的用户。",
			"users.error.last_enabled": "至少要保留一个可用用户。",
			"users.error.totp_exists": "该用户已有 TOTP 密钥（先停用再重新启用）。",
			"users.error.user_store_unavailable": "用户文件暂不可用，请稍后再试。",
			"users.error.network": "网络错误，请稍后再试。",
			"users.error.unknown": "操作失败。"
		};
		const USERS_DICT_EN = {
			"users.nav": "User Management",
			"users.title": "User Management",
			"users.subtitle": "Manage dsh-auth sign-in users (users.yaml)",
			"users.loading": "Loading…",
			"users.unavailable": "User management is unavailable in token mode (password mode only).",
			"users.loadError": "Failed to load the user list.",
			"users.retry": "Retry",
			"users.you": "you",
			"users.admin": "admin",
			"users.disabled": "disabled",
			"users.totpOn": "TOTP",
			"users.changePassword": "Change password",
			"users.newPassword": "New password",
			"users.save": "Save",
			"users.cancel": "Cancel",
			"users.enable": "Enable",
			"users.disable": "Disable",
			"users.delete": "Delete",
			"users.confirmDelete": "Confirm delete",
			"users.totpEnable": "Enable TOTP",
			"users.totpDisable": "Disable TOTP",
			"users.totpSecretTitle": "New TOTP secret (shown only once)",
			"users.totpSecretHint": "Add the base32 secret or otpauth URI to the authenticator app, then verify by signing in.",
			"users.dismiss": "Done",
			"users.addTitle": "Add user",
			"users.username": "Username",
			"users.password": "Password",
			"users.add": "Add",
			"users.empty": "No users yet.",
			"users.note": "Disabling or deleting blocks new sign-ins only; issued sessions stay valid until they expire.",
			"users.noteNonAdmin": "Only admins can add or manage other users; you can change your own password.",
			"users.error.unauthorized": "Session expired; refresh the page and sign in again.",
			"users.error.forbidden": "Permission denied: admins only.",
			"users.error.duplicate": "Username already exists.",
			"users.error.invalid_username": "Invalid username (start with a letter or digit; . _ - allowed).",
			"users.error.empty_password": "Password must not be empty.",
			"users.error.not_found": "User not found.",
			"users.error.self_target": "Cannot disable or delete the signed-in user.",
			"users.error.last_enabled": "Keep at least one enabled user.",
			"users.error.totp_exists": "User already has a TOTP secret (disable it first).",
			"users.error.user_store_unavailable": "User store unavailable; try again later.",
			"users.error.network": "Network error; try again later.",
			"users.error.unknown": "Operation failed."
		};
		//#endregion
		//#region src/client/user-rows.tsx
		/** 行内小按钮（主题变量描边，不硬编码色值）。 */
		const SMALL_BUTTON_STYLE = {
			padding: "4px 10px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "transparent",
			color: "inherit",
			fontFamily: "inherit",
			fontSize: 13,
			lineHeight: "18px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const INPUT_STYLE = {
			padding: "5px 10px",
			borderRadius: 8,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "transparent",
			color: "inherit",
			fontFamily: "inherit",
			fontSize: 13,
			lineHeight: "18px",
			minWidth: 0
		};
		const ROW_STYLE = {
			display: "flex",
			flexWrap: "wrap",
			alignItems: "center",
			gap: 8,
			padding: "10px 0",
			borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
		};
		const NAME_STYLE = {
			fontSize: 14,
			fontWeight: 500,
			marginRight: 4
		};
		const BADGE_STYLE = {
			padding: "1px 8px",
			borderRadius: 999,
			border: "1px solid var(--dsw-alias-border-l2)",
			fontSize: 12,
			lineHeight: "18px",
			opacity: .72
		};
		const ACTIONS_STYLE = {
			display: "flex",
			flexWrap: "wrap",
			gap: 6,
			marginLeft: "auto"
		};
		const FORM_ROW_STYLE = {
			display: "flex",
			flexWrap: "wrap",
			gap: 6,
			flexBasis: "100%"
		};
		/** 单个用户行：状态徽标 + 改密内联表单 + 管理操作组（仅 admin，删除两步确认）。 */
		function UserRow(props) {
			const { user, t, isAdmin, busy } = props;
			const [editing, setEditing] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: ROW_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: NAME_STYLE,
						children: user.username
					}),
					user.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: BADGE_STYLE,
						children: t("users.you")
					}),
					user.admin && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: BADGE_STYLE,
						children: t("users.admin")
					}),
					user.disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: BADGE_STYLE,
						children: t("users.disabled")
					}),
					user.totp && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: BADGE_STYLE,
						children: t("users.totpOn")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: ACTIONS_STYLE,
						children: [(isAdmin || user.current) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: SMALL_BUTTON_STYLE,
							disabled: busy,
							onClick: () => setEditing((open) => !open),
							children: t("users.changePassword")
						}), isAdmin && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdminActions, {
							user,
							t,
							busy,
							onToggleDisabled: props.onToggleDisabled,
							onTotp: props.onTotp,
							onDelete: props.onDelete
						})]
					}),
					editing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PasswordEditor, {
						t,
						busy,
						onSave: async (password) => {
							const ok = await props.onPassword(user.username, password);
							if (ok) setEditing(false);
							return ok;
						}
					})
				]
			});
		}
		/** 管理操作组（仅 admin 挂载）：启停 + TOTP 启停 + 删除（两步确认）。 */
		function AdminActions(props) {
			const { user, t, busy } = props;
			const [confirming, setConfirming] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: SMALL_BUTTON_STYLE,
					disabled: busy || user.current,
					onClick: () => void props.onToggleDisabled(user),
					children: user.disabled ? t("users.enable") : t("users.disable")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: SMALL_BUTTON_STYLE,
					disabled: busy,
					onClick: () => void props.onTotp(user),
					children: user.totp ? t("users.totpDisable") : t("users.totpEnable")
				}),
				confirming ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: SMALL_BUTTON_STYLE,
					disabled: busy,
					onClick: () => {
						setConfirming(false);
						props.onDelete(user.username);
					},
					children: t("users.confirmDelete")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: SMALL_BUTTON_STYLE,
					onClick: () => setConfirming(false),
					children: t("users.cancel")
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: SMALL_BUTTON_STYLE,
					disabled: busy || user.current,
					onClick: () => setConfirming(true),
					children: t("users.delete")
				})
			] });
		}
		/** 改密内联表单（成功由父级关闭）。 */
		function PasswordEditor(props) {
			const { t, busy } = props;
			const [password, setPassword] = (0, react.useState)("");
			const submit = (event) => {
				event.preventDefault();
				if (password !== "") props.onSave(password);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: FORM_ROW_STYLE,
				onSubmit: submit,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "password",
					style: INPUT_STYLE,
					placeholder: t("users.newPassword"),
					"aria-label": t("users.newPassword"),
					value: password,
					onChange: (event) => setPassword(event.target.value)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "submit",
					style: SMALL_BUTTON_STYLE,
					disabled: busy || password === "",
					children: t("users.save")
				})]
			});
		}
		/** 添加用户表单（成功后清空输入）。 */
		function AddUserForm({ t, busy, onAdd }) {
			const [username, setUsername] = (0, react.useState)("");
			const [password, setPassword] = (0, react.useState)("");
			const submit = (event) => {
				event.preventDefault();
				onAdd(username, password).then((ok) => {
					if (ok) {
						setUsername("");
						setPassword("");
					}
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				style: FORM_ROW_STYLE,
				onSubmit: submit,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "text",
						style: INPUT_STYLE,
						placeholder: t("users.username"),
						"aria-label": t("users.username"),
						value: username,
						onChange: (event) => setUsername(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "password",
						style: INPUT_STYLE,
						placeholder: t("users.password"),
						"aria-label": t("users.password"),
						value: password,
						onChange: (event) => setPassword(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						style: SMALL_BUTTON_STYLE,
						disabled: busy || username === "" || password === "",
						children: t("users.add")
					})
				]
			});
		}
		//#endregion
		//#region src/client/totp-reveal.tsx
		const REVEAL_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: 12,
			borderRadius: 12,
			border: "1px solid var(--dsw-alias-border-l2)"
		};
		const CODE_STYLE = {
			fontFamily: "monospace",
			fontSize: 12,
			lineHeight: "18px",
			wordBreak: "break-all",
			userSelect: "all"
		};
		const HINT_STYLE = {
			fontSize: 12,
			lineHeight: "18px",
			opacity: .72
		};
		/** TOTP secret 一次性展示块（base32 + otpauth URI，手动录入认证器）。 */
		function TotpReveal(props) {
			const { reveal, t } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: REVEAL_STYLE,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						t("users.totpSecretTitle"),
						": ",
						reveal.username
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: CODE_STYLE,
						children: reveal.secret
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: CODE_STYLE,
						children: reveal.uri
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: HINT_STYLE,
						children: t("users.totpSecretHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: {
							...SMALL_BUTTON_STYLE,
							alignSelf: "flex-start"
						},
						onClick: props.onDismiss,
						children: t("users.dismiss")
					})
				]
			});
		}
		//#endregion
		//#region src/client/users-api.ts
		/** GET /auth/users；404 = token 模式（端点未注册，落 /auth 兜底）。 */
		async function listUsers() {
			try {
				const res = await fetch("/auth/users");
				if (!res.ok) return {
					ok: false,
					status: res.status,
					code: await readErrorCode(res)
				};
				const body = await res.json();
				return {
					ok: true,
					users: Array.isArray(body.users) ? body.users : []
				};
			} catch {
				return {
					ok: false,
					status: 0,
					code: "network"
				};
			}
		}
		function createUser(username, password) {
			return mutate("POST", {
				username,
				password
			});
		}
		function updateUser(update) {
			const payload = { username: update.username };
			if (update.password !== void 0) payload["password"] = update.password;
			if (update.disabled !== void 0) payload["disabled"] = update.disabled;
			if (update.totp !== void 0) payload["totp"] = update.totp;
			return mutate("PATCH", payload);
		}
		function deleteUser(username) {
			return mutate("DELETE", { username });
		}
		async function mutate(method, payload) {
			try {
				const res = await fetch("/auth/users", {
					method,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				});
				const body = await res.json().catch(() => ({}));
				const result = {
					ok: res.ok,
					status: res.status,
					code: typeof body.error === "string" ? body.error : ""
				};
				if (typeof body.totpSecret === "string") result.totpSecret = body.totpSecret;
				if (typeof body.totpUri === "string") result.totpUri = body.totpUri;
				return result;
			} catch {
				return {
					ok: false,
					status: 0,
					code: "network"
				};
			}
		}
		async function readErrorCode(res) {
			const body = await res.json().catch(() => ({}));
			return typeof body.error === "string" ? body.error : "";
		}
		//#endregion
		//#region src/client/users-section.tsx
		const WRAP_STYLE = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			padding: "4px 0 24px",
			maxWidth: 640
		};
		const TITLE_STYLE = {
			fontSize: 18,
			fontWeight: 600,
			lineHeight: "26px"
		};
		const SUB_STYLE = {
			fontSize: 13,
			lineHeight: "20px",
			opacity: .72
		};
		const ERROR_STYLE = {
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-state-error-primary)"
		};
		/**
		* 「用户管理」设置页（`settings.section` 槽，password 模式专用）：列出 users.yaml
		* 全部用户（管理员/禁用/TOTP/当前登录徽标），支持添加、改密、启停、TOTP 启停、删除。
		* 数据走同源 `/auth/users` 管理 API（会话自校验；token 模式 404 → 不可用提示）。
		* 权限（D13）：非 admin 只能改自己的密码，故隐藏添加表单与其他行的操作按钮，
		* 服务端对越权变更恒 403（UI 降级只是镜像，API 才是权威）。
		*/
		function SettingsUsersSection({ t }) {
			const tr = (0, react.useCallback)((key) => typeof t === "function" ? t(key) : key, [t]);
			const [state, setState] = (0, react.useState)("loading");
			const [users, setUsers] = (0, react.useState)([]);
			const [errorCode, setErrorCode] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [reveal, setReveal] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(async () => {
				const result = await listUsers();
				if (result.ok) {
					setUsers(result.users);
					setState("ready");
				} else setState(result.status === 404 ? "unavailable" : "error");
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			/** 变更统一入口：busy + 错误码 + 成功后刷新列表；返回值供表单清理/后续展示。 */
			const run = (0, react.useCallback)(async (action) => {
				setBusy(true);
				setErrorCode("");
				const result = await action();
				setBusy(false);
				if (result.ok) await refresh();
				else setErrorCode(result.code === "" ? "unknown" : result.code);
				return result;
			}, [refresh]);
			/** TOTP 启停：enable 额外展示一次性 secret（响应里只有这一次）。 */
			const handleTotp = (0, react.useCallback)(async (user) => {
				const result = await run(() => updateUser({
					username: user.username,
					totp: user.totp ? "disable" : "enable"
				}));
				if (result.ok && result.totpSecret !== void 0 && result.totpUri !== void 0) setReveal({
					username: user.username,
					secret: result.totpSecret,
					uri: result.totpUri
				});
				return result.ok;
			}, [run]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: WRAP_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: TITLE_STYLE,
					children: tr("users.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: SUB_STYLE,
					children: tr("users.subtitle")
				})] }), state === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReadyPanel, {
					tr,
					users,
					isAdmin: users.find((user) => user.current)?.admin === true,
					errorCode,
					reveal,
					busy,
					onDismissReveal: () => setReveal(null),
					onAdd: (u, p) => run(() => createUser(u, p)).then((r) => r.ok),
					onPassword: (u, p) => run(() => updateUser({
						username: u,
						password: p
					})).then((r) => r.ok),
					onToggleDisabled: (u) => run(() => updateUser({
						username: u.username,
						disabled: !u.disabled
					})).then((r) => r.ok),
					onDelete: (u) => run(() => deleteUser(u)).then((r) => r.ok),
					onTotp: handleTotp
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionState, {
					state,
					t: tr,
					onRetry: () => void refresh()
				})]
			});
		}
		/** ready 态主体：错误条 + TOTP 展示块 + 用户行列表 + 添加表单（仅 admin）+ 脚注。 */
		function ReadyPanel(props) {
			const { tr, users, isAdmin, errorCode, reveal, busy } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				errorCode !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: ERROR_STYLE,
					role: "alert",
					children: errorText(tr, errorCode)
				}),
				reveal !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TotpReveal, {
					reveal,
					t: tr,
					onDismiss: props.onDismissReveal
				}),
				users.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: SUB_STYLE,
					children: tr("users.empty")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: users.map((user) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UserRow, {
					user,
					t: tr,
					isAdmin,
					busy,
					onPassword: props.onPassword,
					onToggleDisabled: props.onToggleDisabled,
					onTotp: props.onTotp,
					onDelete: props.onDelete
				}, user.username)) }),
				isAdmin && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddUserForm, {
					t: tr,
					busy,
					onAdd: props.onAdd
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: SUB_STYLE,
					children: tr(isAdmin ? "users.note" : "users.noteNonAdmin")
				})
			] });
		}
		/** 非 ready 三态：加载中 / token 模式不可用 / 加载失败（可重试）。 */
		function SectionState(props) {
			const { state, t } = props;
			if (state === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: SUB_STYLE,
				children: t("users.loading")
			});
			if (state === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: SUB_STYLE,
				children: t("users.unavailable")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: SUB_STYLE,
				children: [
					t("users.loadError"),
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: { textDecoration: "underline" },
						onClick: props.onRetry,
						children: t("users.retry")
					})
				]
			});
		}
		/** 错误码 → 本地化文案；码缺失（词典未覆盖）时回落 generic。 */
		function errorText(t, code) {
			const key = `users.error.${code}`;
			const text = t(key);
			return text === key ? t("users.error.unknown") : text;
		}
		//#endregion
		//#region src/client/index.tsx
		/** 本插件文案的词典命名域（locale 服务按 (ns, locale) 分开注册）。 */
		const AUTH_NS = "auth";
		/** 命名词典里登出键。 */
		const LOGOUT_KEY = "logout";
		/** 命名词典里「当前登录」用户名行键。 */
		const SIGNED_IN_AS_KEY = "signedInAs";
		/**
		* 默认槽位 order：注册时先用它（与 host 端 Config 默认一致），随后 `/auth/status`
		* 探针读到 host 配置的 `logoutOrder` 时按配置重注册。1000 已大于 dsh 自带条目
		* （permission -20 / language 0 / appearance 10 / composer-enter 20），
		* 除非第三方插件注册更大的 order，按钮始终留在通用设置页最底部。
		*/
		const DEFAULT_LOGOUT_ORDER = 1e3;
		/**
		* 「用户管理」设置页（settings.section）的导航 order：内置页 general 0 /
		* models 10 / plugins 15 / agent-presets 20 之后、第三方页（如 better-sidebar 100）
		* 之前。固定常量即可：section 级碰撞概率低，导航图标按 id 落到默认齿轮。
		*/
		const USERS_SECTION_ORDER = 30;
		/**
		* dsh-auth-gate client 半边，设置面板两处挂载：
		*
		* 1. 「用户管理」整页（`settings.section`，id `auth-users`，order 30）：password
		*    模式下的 users.yaml 管理 UI（列表/添加/改密/启停/TOTP/删除），数据走同源
		*    `/auth/users` 管理 API；token 模式端点未注册（404），页面显示不可用提示。
		* 2. 「退出登录 / Sign out」按钮（`settings.general.item`，root 作用域可追加列表
		*    槽，General 页堆叠渲染，按 order 升序）：会话带用户名时（password 模式），
		*    按钮上方显示「当前登录：\<username\>」，数据来自 `/auth/status` 探针
		*    （token 模式 username 恒 null，不渲染该行）。
		*
		* 登出顺序可配置：先以默认 order（1000）注册（探针失败/未开始前按钮也可见），再探
		* `/auth/status` 读取 host 配置的 `logoutOrder`，与默认不同则按配置值重注册
		* （同 id 注册 = 槽位替换，先注册新条目再释放旧条目，避免中间态空白）。
		*
		* 文案挂进 dsh 现有的 locale 机制（与「设置」里的语言切换同一套）：注册 `auth`
		* 词典（zh/en，登出键 + users.* 用户管理键），再以 `locale: "auth"` 给注册条目
		* 注入 `t` seat，文字随界面语言实时切换。不改任何服务端端点/会话语义。
		*/
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => [ctx.locale.register(AUTH_NS, "zh", {
				[LOGOUT_KEY]: "退出登录",
				[SIGNED_IN_AS_KEY]: "当前登录",
				...USERS_DICT_ZH
			}), ctx.locale.register(AUTH_NS, "en", {
				[LOGOUT_KEY]: "Sign out",
				[SIGNED_IN_AS_KEY]: "Signed in as",
				...USERS_DICT_EN
			})], "auth: logout dictionary");
			const t = ctx.locale.bind(AUTH_NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "auth-users",
				locale: AUTH_NS,
				order: USERS_SECTION_ORDER,
				label: () => t("users.nav")
			}, SettingsUsersSection));
			ctx.slots.inject("settings.general.item", () => {
				const mount = (order) => ctx.slots.register({
					name: "settings.general.item",
					id: "dsh-auth-gate-logout",
					locale: AUTH_NS,
					order,
					label: () => t(LOGOUT_KEY)
				}, SettingsLogoutAction);
				let dispose = mount(DEFAULT_LOGOUT_ORDER);
				try {
					fetch("/auth/status").then((res) => res.json()).then((body) => {
						const order = body.logoutOrder;
						if (typeof order !== "number" || !Number.isInteger(order) || order === DEFAULT_LOGOUT_ORDER) return;
						const previous = dispose;
						dispose = mount(order);
						previous?.();
					}).catch(() => void 0);
				} catch {}
				return () => dispose?.();
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map