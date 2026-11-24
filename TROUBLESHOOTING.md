# Troubleshooting

先运行：

```bash
gemini-github-mcp status
gemini-github-mcp verify
```

`gemini-github-mcp status` 会展示本机保存的部署地址、工具范围与线上 `/health` 状态；`gemini-github-mcp verify` 会检查健康状态、OAuth metadata、动态客户端注册和 `/mcp` 的未认证保护。

## `gemini-github-mcp setup` 提示 Cloudflare 未登录

交互式终端下 `gemini-github-mcp setup` 会自动拉起内置 Wrangler 打开浏览器登录；如需手动登录或切换账号，运行：

```bash
gemini-github-mcp login
gemini-github-mcp setup
```

如果浏览器无法完成登录，改用 Cloudflare API Token，并确保账号拥有 Workers Scripts 编辑权限。

登录了多个 Cloudflare 账号时，setup 会要求选择账号。非交互环境可提前设置：

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
gemini-github-mcp setup
```

从 GitHub Release 安装后如果 npm 提示 `install-scripts` 被阻止，可重新安装并显式放行 Wrangler 的已知构建依赖：

```bash
npm install --global \
  https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/gemini-github-mcp-proxy.tgz \
  --allow-scripts=esbuild,fsevents,workerd
```

## Windows 常见问题（PowerShell 执行策略、Git Bash、PATH）

1. **提示“无法加载 `gemini-github-mcp.ps1`，因为在此系统上禁止运行脚本”**：
   - 直接运行 `gemini-github-mcp.cmd setup`（跳过 `.ps1` 包装脚本，无需修改系统 PowerShell 执行策略）。
2. **在 Git Bash（mintty）下提示“setup 需要交互式终端”**：
   - Git Bash 的 mintty 终端下 Node.js 无法以原生 TTY 读取隐藏输入，请改用 **PowerShell**、**Windows Terminal** 或 **命令提示符（CMD）** 运行 `gemini-github-mcp setup`。
3. **安装后提示找不到 `gemini-github-mcp` 命令**：
   - 运行 `npm.cmd prefix -g` 获取全局目录（通常为 `%APPDATA%\npm`），在当前 PowerShell 会话执行 `$env:PATH = "$(npm.cmd prefix -g);$env:PATH"`，或将该目录加入系统环境变量 `PATH` 后重开终端。

## 部署后没有 `workers.dev` 地址

全新 Cloudflare 账号首次部署前需先开通免费的 `workers.dev` 子域。`setup` 检测到该问题时会直接打印对应账号的 Cloudflare Dashboard 链接，打开并创建子域后重新运行 `gemini-github-mcp setup` 即可。企业策略可能禁止公开 `workers.dev`；此时需要配置自定义域名，并同步调整验收和 Connector URL。

## GitHub PAT 验证失败

检查：

- Token 是否过期或被撤销
- 是否选择了目标仓库
- 当前任务需要的资源权限是否已授予
- 组织仓库是否等待管理员批准 fine-grained token

PAT 的范围由你决定。需要 Actions、Workflows、Administration、Secrets 等能力时，添加对应权限；工具不会在 Worker 层替你扩大或缩小 PAT 权限。

## GitHub 返回 403

通常表示 PAT 缺少当前工具需要的权限。按操作检查：

- 读写文件或 commit：Contents
- 修改 workflow 文件：Contents + Workflows
- Issue：Issues
- PR 与审阅：Pull requests
- Actions：Actions
- 仓库管理：Administration 或相应组织权限

是否授予这些权限由你决定，不需要为了使用本工具统一开放更大权限。

## 工具太多、选择不准或超过模型上下文

默认会透传 GitHub Remote MCP 的全部工具，这是为了不替用户删减能力。需要更小的工具面时可显式指定：

```bash
gemini-github-mcp setup --tools get_file_contents,pull_request_read,issue_read
```

恢复全部工具：

```bash
gemini-github-mcp setup --tools all
```

在已有部署上仅传入 `--tools`（不带 `--rotate`）不会轮换 PAT、PIN 或中断 Gemini 连接，无需重新授权。`--tools` 会通过 GitHub Remote MCP 的 `X-MCP-Tools` 头生效；工具名拼写错误时，上游可能返回空集合或错误。

## Connector 名称与已有应用冲突导致 @ 提及异常

如果 Connector 名称以已安装应用名开头（例如自定义应用叫 `GitHub Dev MCP`，而内置 `GitHub` 已安装），Gemini 可能先把 `@GitHub` 解析为内置应用，后面的 `Dev MCP` 被当作普通文本，导致自定义应用没有绑定。

名称应使用不与已有应用重名的单个词，例如 `GitHubDevMCP`；不要包含空格、`-`、`_` 或 `.`。其他带空格的应用（如 Google Workspace）通常不受影响，因为它们没有和已有应用重名。

已存在的 Connector：

1. 优先在 Gemini 设置中重命名。
2. 没有重命名入口时，删除后重新添加，并重新完成 OAuth 与 PIN 授权。
3. 旧聊天不会自动换绑；新建聊天后重新输入 `@` 选择。

## Gemini 显示 Connector 已连接，但模型说工具不可用

1. 确认新聊天中先输入 `@`。
2. 从自动完成菜单选择 `GitHubDevMCP`。
3. 确认没有把名称作为普通文本粘贴。
4. 优先使用“自动”或 `Neon`。
5. 新建聊天，避免沿用旧的工具绑定状态。
6. 检查每次工具调用时是否出现新的许可提示。

实测中 `Hydrogen` 曾无法绑定自定义工具，`Carbon` 受订阅档位限制。模式名称和可用性可能随 Gemini UI 变化。

## 授权 PIN 丢失

只轮换 PIN，不动 PAT 和签名密钥：

```bash
gemini-github-mcp setup --pin-only
gemini-github-mcp verify
```

现有 OAuth 令牌和 Gemini 连接不会失效。只有需要同时让旧令牌全部失效时，才使用 `setup --rotate`。

## Gemini 提示“未能自动向此服务器注册”

这是 Gemini 的 DCR 自动注册失败。复制弹窗里的“重定向 URI”，然后运行：

```bash
gemini-github-mcp client --redirect-uri "<粘贴重定向 URI>"
```

把输出的客户端 ID 和客户端密钥填回 Gemini。新版 Worker 会返回服务端派生的密钥；旧版 Worker 会生成本地密钥并给出提示。

## 授权页点击“授权并继续”无反应或提示 Session token is expired

授权页约 10 分钟内有效。过期后不要刷新或重复点击旧页面，回到 Gemini：

1. 删除当前自定义 Connector。
2. 重新添加 `GitHubDevMCP`。
3. 在新弹出的授权页重新输入 PIN。

如果页面仍无反应，检查浏览器是否拦截了弹窗或表单提交，或换一个窗口打开授权页。PIN 正确时 Worker 会返回 `302`；可用 `gemini-github-mcp verify` 确认部署正常。

## OAuth 授权页反复出现

检查：

1. 是否输入了 setup 最后输出的 12 位 PIN。
2. 如果只是 PIN 丢失，运行 `gemini-github-mcp setup --pin-only`；如果运行过 `setup --rotate`，旧 PIN 和旧令牌全部失效。
3. Worker 日志中是否有 `/authorize` 400，通常是回调前缀不匹配。
4. 是否在 Gemini 中重新添加了 Connector。
5. 授权页是否已超过约 10 分钟的有效期。

如果授权页返回 `429 Too many authorization attempts`，说明同一来源一分钟内提交 PIN 超过 10 次。等待 60 秒后重试；不要连续脚本化尝试。

## MCP 返回 401

这是预期保护。`/mcp` 必须携带 OAuth access token。

如果 Gemini 始终返回 401：

1. 删除并重新添加 Connector。
2. 完成 OAuth 授权。
3. 如果仍失败，轮换 Secrets 后重试。

## 文件工具只返回 SHA 或“非文本内容”

确认部署的是当前版本：

```bash
curl -fsSL https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.sh | sh
gemini-github-mcp setup --rotate
gemini-github-mcp verify
```

Worker 必须把 JSON 和 SSE 中的文本 `resource` 提升为普通 `text`。若仍只有状态行，查看 Cloudflare Worker Logs，确认上游响应类型和代理版本。

## 读取仓库返回 404

通常不是 Gemini 的问题，而是 PAT 没有目标仓库权限。用同一 PAT 检查：

```bash
curl -H "Authorization: Bearer <PAT>" \
  https://api.github.com/repos/<owner>/<repo>
```

不要在聊天、Issue 或日志中粘贴真实 PAT。

## 修改代码成功，但无法运行测试

这是预期限制。Gemini App 没有本地文件系统和 shell。正确流程是：

1. Gemini 创建分支、提交并打开 Draft PR。
2. GitHub Actions 运行测试。
3. Codex、Claude Code、Antigravity 或其他 code agent 基于同一 PR 继续修复。

## 如何安全重来

只更换 PIN：

```bash
gemini-github-mcp setup --pin-only
gemini-github-mcp verify
```

彻底轮换 PAT、PIN 与签名密钥：

```bash
gemini-github-mcp setup --rotate
gemini-github-mcp verify
```

然后在 Gemini 中删除并重新添加 `GitHubDevMCP`。`setup --pin-only` 不会使现有令牌失效；`setup --rotate` 会因 `SIGNING_SECRET` 轮换使旧令牌全部失效。
