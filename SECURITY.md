# Security

## 推荐部署模型

每个使用者独立部署：

```text
一个人
  = 一个 Cloudflare Worker
  + 一个 GitHub PAT
  + 一个 Gemini Connected App
```

不要把一个已经授权的 Worker URL 当作朋友共用入口。Worker 只区分 OAuth client，不区分不同人的 GitHub 身份；所有 MCP 请求最终都使用 Worker Secret 中的同一个 PAT。

## 凭据与数据边界

| 数据 | 保存位置 | 是否进入 Gemini |
|---|---|---|
| `GITHUB_PAT` | Cloudflare Worker Secret | 否 |
| `ADMIN_PIN` | Cloudflare Worker Secret、setup 一次性输出 | 用户手动输入授权页 |
| `SIGNING_SECRET` | Cloudflare Worker Secret | 否 |
| OAuth access / refresh token | Gemini 凭据存储；无状态签名令牌 | 是，作为 Bearer token |
| 仓库文件、Issue、PR | GitHub；仅在工具调用需要时经 Worker 转发 | 是，取决于任务内容 |

Provider 配置保存在用户配置目录，只包含 Worker URL、MCP URL、Worker 名称和部署时间，不含 Secret。

## GitHub PAT

使用 fine-grained PAT，并把仓库范围限制到确实需要操作的项目：

- Metadata：Read
- Contents：Read and write
- Issues：Read and write
- Pull requests：Read and write

不要授予：

- Administration
- Actions write
- Secrets
- Organization administration
- 所有仓库访问

需要组织仓库时，先确认组织的 fine-grained token 审批策略。

## 工具白名单

Worker 默认只允许代码、Issue、PR 和有限审阅工具。明确排除：

- `delete_file`
- `merge_pull_request`
- `create_repository`
- `fork_repository`

工具白名单降低误操作面，但不是 GitHub 权限沙箱。PAT 仍应遵循最小仓库、最小资源权限。

## 授权 PIN

setup 生成随机 12 位数字 PIN，只在完成后显示一次。不要把 PIN 发到聊天、Issue、PR 或截图。

遗失 PIN 时：

```bash
gemini-github-mcp setup --rotate
```

这会轮换全部 Secret。回到 Gemini，在 Connected Apps 中删除旧 Connector，再按新 PIN 重新添加。

## 令牌失效与轮换

当前 access token 和 refresh token 都是 HMAC 签名的无状态令牌，有效期 10 年。

- 只轮换 `ADMIN_PIN`：阻止新授权，但不使已有 access/refresh token 失效。
- 轮换 `SIGNING_SECRET`：立即让所有已有 access/refresh token 失效。
- 轮换 `GITHUB_PAT`：已有 Gemini token 仍有效，但 Worker 之后的 GitHub 请求会使用新 PAT。
- 删除 Gemini Connector：停止该客户端使用，但不会单独吊销无状态令牌。

发生凭据泄露时，应同时：

1. 在 GitHub 撤销 PAT。
2. 运行 `gemini-github-mcp setup --rotate`。
3. 在 Gemini 删除并重新添加 Connector。
4. 检查 GitHub 审计日志、分支、commit、Issue 和 PR。

## 部署安全

- 保持 `workers_dev: true` 并使用 HTTPS。
- 不要把 Secrets 写入 `.dev.vars`、源码、命令参数或 shell 历史。
- `ALLOWED_REDIRECT_PREFIX` 默认只接受 Gemini 官方 OAuth 回调前缀。
- 动态客户端注册只接受该受信回调前缀，并返回公共客户端 `token_endpoint_auth_method: none`。
- 授权请求必须使用 `S256` PKCE；不支持 `plain` 或缺失 `code_challenge`。
- 授权页返回 `no-store`、CSP、禁止 iframe 和 no-referrer 响应头。
- Worker 健康检查只返回配置是否齐全，不返回 Secret。

## 范围限制

- Worker 没有本地命令执行环境，不能替代 CI。
- MCP 工具被允许不代表操作一定安全；模型仍可能提出错误修改。
- 代码修改应进入新分支并创建 Draft PR，由人工或其他受控 agent 审核后合并。
