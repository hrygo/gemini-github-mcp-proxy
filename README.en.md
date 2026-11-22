# Gemini GitHub MCP Proxy

Give Gemini Web and the Gemini mobile app real GitHub development tools without requiring `gh`: read repositories, edit files, push commits, create Draft PRs, and manage Issues.

Deploy **one Worker per person**, with that person's own GitHub PAT. Do not share one Worker as a multi-user service; every connected user would act as the PAT owner.

## Quick start

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
npx gemini-github-mcp-proxy setup
```

Or install globally:

```bash
npm install --global gemini-github-mcp-proxy
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
npx gemini-github-mcp-proxy setup            # first deployment
npx gemini-github-mcp-proxy setup --rotate   # rotate all secrets
npx gemini-github-mcp-proxy verify           # verify deployed endpoints
npm run check                                # source development checks
npm run deploy                               # redeploy current source only
```

## Sharing

Friends install directly from npm and run setup in their own Cloudflare and GitHub account:

```bash
npx wrangler login
npx gemini-github-mcp-proxy setup
```

Never share a GitHub PAT, Cloudflare Secret, authorization PIN, or an already-authorized Worker URL unless you intend to grant access to your GitHub identity.

## Why a Worker is required

GitHub's hosted Remote MCP currently lacks the complete Dynamic Client Registration and refresh-token behavior expected by Gemini. It also returns file bodies as MCP `EmbeddedResource` blocks that Gemini drops. This Worker provides the OAuth bridge, PAT isolation, tool allowlist, and text normalization.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) when the connector does not appear or tools are not invoked.
