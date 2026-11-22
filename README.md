# Gemini GitHub MCP Proxy

让 Gemini Web 与 Gemini 手机 App 直接读取代码、修改文件、提交 commit、创建 Draft PR、处理 Issue，不依赖 Gemini 执行 `gh`。

每个使用者部署自己的 Cloudflare Worker，并绑定自己的 GitHub PAT。不要把同一个 Worker 当作多人共享服务：那会让所有人以同一个 GitHub 身份操作。

[English quick start](README.en.md)

## 能做什么

- 读取私有和公开仓库文件、commit、branch、Issue 与 PR
- 创建分支、提交或更新文件
- 创建与更新 Draft PR
- 读取、创建、更新 Issue，添加评论
- 执行 PR 审阅和行内评论
- Gemini 网页端连接一次，同一 Google 账号的移动端复用同一 Connector

默认工具白名单不包含 `delete_file`、`merge_pull_request`、`create_repository`、`fork_repository`。合并和删除应由人工或其他受控 agent 完成。

## 快速开始

### 安装

不需要注册 npm 账号。安装包由 GitHub Release 提供：

**macOS / Linux**

```bash
curl -fsSL https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.ps1 | iex
```

也可以手动下载 Release 中的 `gemini-github-mcp-proxy.tgz`，校验 `SHA256SUMS` 后安装：

```bash
npm install --global \
  https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/gemini-github-mcp-proxy.tgz
```

安装包依赖由 npm 公共 Registry 自动下载，但**不需要 npm 账号，也不需要该工具发布到 npm**。

升级时重新执行上面的安装命令。卸载：

```bash
npm uninstall --global gemini-github-mcp-proxy
```

### 1. 准备

- Node.js 22 或更高版本
- 一个 Cloudflare 账号
- 一个 GitHub fine-grained PAT

在 GitHub `Settings → Developer settings → Personal access tokens → Fine-grained tokens` 创建 PAT，仅选择需要操作的仓库：

| 权限 | 级别 |
|---|---|
| Metadata | Read |
| Contents | Read and write |
| Issues | Read and write |
| Pull requests | Read and write |

### 2. 部署

```bash
npx wrangler login
gemini-github-mcp setup
```

setup 会：

1. 检查 Cloudflare 登录状态
2. 安全读取并验证 GitHub PAT
3. 生成随机 12 位授权 PIN 和签名密钥
4. 部署 Worker
5. 一次上传三个 Cloudflare Secrets
6. 验收 OAuth、DCR、MCP 与鉴权端点
7. 输出 Connector URL 和授权 PIN

成功后终端会显示：

```text
Connector 名称：GitHub Dev MCP
MCP URL：https://gemini-github-mcp-proxy.<你的子域>.workers.dev/mcp
授权 PIN：<只显示一次>
```

PAT、授权 PIN 和签名密钥不会写入仓库或配置文件。非敏感部署信息保存在用户配置目录，供 `gemini-github-mcp verify` 使用。

## 接入 Gemini

1. 在 Gemini Web 打开 `设置 → 已连接的应用`。
2. 添加自定义 MCP App，名称填写 `GitHub Dev MCP`。
3. MCP URL 使用 setup 输出的地址。
4. Gemini 自动完成动态客户端注册；授权页输入部署时生成的 12 位 PIN。
5. 手机端使用同一 Google 账号即可看到该 Connector。

每个新聊天必须：

1. 输入 `@`。
2. 从自动完成菜单明确选择 `GitHub Dev MCP`。
3. 再输入任务。

只在正文中手写 `@GitHub Dev MCP` 不会可靠绑定工具。

## 推荐用法

先读后写：

```text
@GitHub Dev MCP 读取 owner/repo 和相关 Issue。
先分析现状并给出修改计划，不要写文件。
```

确认后实施：

```text
@GitHub Dev MCP 按已确认方案创建新分支，修改文件并提交。
创建 Draft PR，说明变更、验证和风险。不要合并。
```

Issue 协作：

```text
@GitHub Dev MCP 读取 Issue #123，在同一 Issue 回复结论和对应 Draft PR。
```

Gemini 没有本地 shell 和文件系统；提交后可让 GitHub Actions、Codex 或其他 code agent 接管测试和继续修复。

## 常用命令

```bash
gemini-github-mcp setup            # 首次部署
gemini-github-mcp setup --rotate   # 强制轮换全部 Secrets
gemini-github-mcp verify           # 验收已部署 Worker
npm run check                                # 源码开发检查
npm run deploy                               # 只重新部署当前代码
```

指定其他部署地址验收：

```bash
gemini-github-mcp verify --url https://example.workers.dev
```

## 分享给朋友

把 [Releases](https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest) 页面发给朋友。朋友不需要 npm 账号，也不需要下载仓库源码：

```bash
curl -fsSL https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.sh | sh
npx wrangler login
gemini-github-mcp setup
```

Windows 用户使用上面的 PowerShell 命令。安装脚本会下载固定名称的 Release 制品、校验 `SHA-256`，然后执行全局安装。

不要把以下内容发给别人：

- Cloudflare Secret
- GitHub PAT
- 授权 PIN
- 你已授权的 Connector URL，除非你明确允许对方使用你的 GitHub 身份

## 工作原理

```text
Gemini Web / Mobile
        │ OAuth 2.1 + PKCE + DCR
        ▼
Cloudflare Worker
  ├─ 验证 Bearer token
  ├─ 注入 GitHub PAT
  ├─ 限制 MCP 工具
  └─ 修正 EmbeddedResource 文件正文
        │
        ▼
GitHub 官方 Remote MCP
        │
        ▼
GitHub API
```

需要 Worker 的原因：

- GitHub Remote MCP 当前未完整满足 Gemini 所需的 DCR 与刷新令牌组合。
- Gemini 会丢弃 GitHub 文件工具返回的 `EmbeddedResource`，只剩 SHA 状态文本。
- PAT 不能安全地交给 Gemini 或移动端浏览器。
- 集中工具白名单比直接暴露 GitHub 全部 MCP 写能力更可控。

## 安全

- 授权 PIN 为随机 12 位数字，只在 setup 中显示一次。
- `ADMIN_PIN`、`SIGNING_SECRET`、`GITHUB_PAT` 只存 Cloudflare Secret。
- `/mcp` 必须携带签名有效的 Bearer token。
- access token 与 refresh token 当前有效期均为 10 年；轮换 `SIGNING_SECRET` 会统一失效。
- 断开 Gemini Connector 不等于立即吊销服务端令牌；高风险场景应同时轮换签名密钥和 GitHub PAT。

完整威胁模型与轮换步骤见 [SECURITY.md](SECURITY.md)。

## 成本

个人使用 Cloudflare Workers Free 即可。截至 2026-11-22，官方免费额度为每天 100,000 次请求、每次 10ms CPU。[Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) 与 [Limits](https://developers.cloudflare.com/workers/platform/limits/) 可能变化，启用付费产品或高流量前请重新核对。

## 排障

常见问题见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。优先运行：

```bash
gemini-github-mcp verify
npx wrangler deployments status
```

## 开发

```bash
npm install
npm run check
npm run dev
```

测试覆盖 OAuth/DCR、鉴权、工具白名单、JSON/SSE 文件正文转换和部署辅助函数。发布流程与制品规范见 [RELEASING.md](RELEASING.md)。

## 参考

- [Google：连接和管理自定义 Gemini App](https://support.google.com/gemini/answer/17209137)
- [GitHub Remote MCP Server 配置](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)
- [GitHub MCP：Gemini DCR/refresh 兼容问题](https://github.com/github/github-mcp-server/issues/3519)
- [GitHub MCP：EmbeddedResource 文件正文问题](https://github.com/github/github-mcp-server/issues/3189)
