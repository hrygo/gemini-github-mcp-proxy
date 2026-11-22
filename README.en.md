# Gemini GitHub MCP Proxy

Give Gemini Web and the Gemini mobile app real GitHub development tools without requiring `gh`: read repositories, edit files, push commits, create Draft PRs, and manage Issues.

Deploy **one Worker per person**, with that person's own GitHub PAT. Do not share one Worker as a multi-user service; every connected user would act as the PAT owner.

## Quick start

Install from the fixed GitHub Release asset. No npm account is required:

**macOS / Linux**

```bash
curl -fsSL https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.ps1 | iex
```

Or download `gemini-github-mcp-proxy.tgz` and install it manually:

```bash
npm install --global \
  https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/gemini-github-mcp-proxy.tgz
```

The package dependencies still come from the public npm Registry. The tool itself does not need an npm account or an npm-published package.

Requirements:

- Node.js 22+
- A Cloudflare account
- A GitHub fine-grained PAT scoped to selected repositories with:
  - Metadata: Read
  - Contents: Read and write
  - Issues: Read and write
  - Pull requests: Read and write

```bash
npx wrangler login
gemini-github-mcp setup
```

The setup command deploys the Worker, generates secrets, uploads them to Cloudflare, verifies OAuth/DCR, and prints:

```text
Connector name: GitHub Dev MCP
MCP URL: https://gemini-github-mcp-proxy.<your-subdomain>.workers.dev/mcp
Authorization PIN: <shown once>
```

## Connect Gemini

1. Open Gemini Web → Settings → Connected apps.
2. Add a custom MCP app named `GitHub Dev MCP`.
3. Enter the MCP URL printed by setup.
4. Complete OAuth and enter the generated 12-digit authorization PIN.
5. The same Google account can use the connector on Gemini mobile.

In every new chat:

1. Type `@`.
2. Select `GitHub Dev MCP` from the autocomplete menu.
3. Enter the task.

Typing the connector name as plain text does not reliably bind the tools.

## Security

- The Worker injects a GitHub PAT stored only in Cloudflare Secrets.
- Gemini never receives the PAT.
- The authorization page requires a random 12-digit PIN.
- `/mcp` requires a signed Bearer token.
- Destructive tools such as `delete_file` and `merge_pull_request` are excluded.

See [SECURITY.md](SECURITY.md) for the threat model and rotation procedure.

## Commands

```bash
gemini-github-mcp setup            # first deployment
gemini-github-mcp setup --rotate   # rotate all secrets
gemini-github-mcp verify           # verify deployed endpoints
npm run check                                # source development checks
npm run deploy                               # redeploy current source only
```

## Sharing

Share the [latest GitHub Release](https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest). Friends do not need an npm account:

```bash
curl -fsSL https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/install.sh | sh
npx wrangler login
gemini-github-mcp setup
```

Never share a GitHub PAT, Cloudflare Secret, authorization PIN, or an already-authorized Worker URL unless you intend to grant access to your GitHub identity.

## Why a Worker is required

GitHub's hosted Remote MCP currently lacks the complete Dynamic Client Registration and refresh-token behavior expected by Gemini. It also returns file bodies as MCP `EmbeddedResource` blocks that Gemini drops. This Worker provides the OAuth bridge, PAT isolation, tool allowlist, and text normalization.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) when the connector does not appear or tools are not invoked.
