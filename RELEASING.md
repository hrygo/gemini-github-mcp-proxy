# Releasing

包名：

```text
gemini-github-mcp-proxy
```

发布源：

```text
https://github.com/hrygo/gemini-github-mcp-proxy
```

## 发布模型

- `ci.yml`：每次 push / PR 执行测试、类型检查与脚本语法检查。
- `publish.yml`：GitHub Release 发布后，通过 npm Trusted Publishing 的 OIDC 身份执行 `npm publish`。
- 工作流不保存长期 `NPM_TOKEN`。
- npm 自动生成 provenance，将包链接到 GitHub 源码和 workflow。

## 首次建立包名

npm 要求包已存在后才能配置 Trusted Publishing。首次发布需要登录 npm：

```bash
npm login
npm publish --access public
```

确认版本可以从 npm 安装：

```bash
npx gemini-github-mcp-proxy --help
```

## 配置 Trusted Publisher

首次发布后，在 npm 包设置中添加 GitHub Actions Trusted Publisher，或使用：

```bash
npm trust github gemini-github-mcp-proxy \
  --repo hrygo/gemini-github-mcp-proxy \
  --file publish.yml \
  --env npm \
  --allow-publish \
  --yes
```

新配置必须在 48 小时内完成一次成功发布。

建议随后在 npm 包设置中启用发布时 MFA/2FA，并限制长期 token：

```bash
npm access set mfa=publish gemini-github-mcp-proxy
```

## 后续版本

```bash
npm version patch
git push
gh release create "v$(node -p "require('./package.json').version")" \
  --generate-notes
```

GitHub Release 发布后，`publish.yml` 会：

1. 检查 tag 与 `package.json` 版本一致。
2. 运行完整 CI。
3. 使用 OIDC Trusted Publishing 执行 `npm publish`。

## 回退

npm 版本不可覆盖。发现问题时发布修复版本，例如：

```bash
npm version patch
```

需要紧急隐藏错误版本时使用 npm 的 unpublish/deprecate 策略，但不要删除仍被用户锁定的版本。
