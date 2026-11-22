#!/bin/sh
set -eu

repo="hrygo/gemini-github-mcp-proxy"
base_url="https://github.com/${repo}/releases/latest/download"
archive="gemini-github-mcp-proxy.tgz"

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm。请先安装 Node.js 22 或更高版本。" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "未找到 curl，无法下载 GitHub Release 制品。" >&2
  exit 1
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/gemini-github-mcp.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

echo "正在下载 ${archive}..."
curl --proto '=https' --tlsv1.2 -fsSL \
  "${base_url}/${archive}" \
  -o "${tmp_dir}/${archive}"
curl --proto '=https' --tlsv1.2 -fsSL \
  "${base_url}/SHA256SUMS" \
  -o "${tmp_dir}/SHA256SUMS"

echo "正在校验 SHA-256..."
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp_dir" && sha256sum -c SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$tmp_dir" && shasum -a 256 -c SHA256SUMS)
else
  echo "系统缺少 sha256sum 或 shasum，无法校验安装包。" >&2
  exit 1
fi

echo "正在安装 Gemini GitHub MCP..."
npm install --global \
  --allow-scripts=esbuild,fsevents,workerd \
  "${tmp_dir}/${archive}"
gemini-github-mcp --version

cat <<'EOF'

安装完成。下一步：
  1. npx wrangler login
  2. gemini-github-mcp setup

每个使用者必须使用自己的 Cloudflare 账号和 GitHub PAT。
EOF
