#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { normalizeBaseUrl, parseClientOptions, readConfig } from "./lib.mjs";

function printHelp() {
  console.log(`
Gemini GitHub MCP Proxy 手动 OAuth 客户端

用法：
  gemini-github-mcp client --redirect-uri https://oauth-redirect.googleusercontent.com/r/...
  gemini-github-mcp client --redirect-uri <uri> --url https://<worker>.<subdomain>.workers.dev
  gemini-github-mcp client --redirect-uri <uri> --name "Gemini GitHub MCP"

说明：
  当 Gemini 提示“未能自动向此服务器注册”时，先把弹窗里的重定向 URI
  复制出来，再用本命令注册客户端。命令会输出客户端 ID 与客户端密钥，
  直接填入 Gemini 的手动 OAuth 表单即可。
`);
}

async function main() {
  const options = parseClientOptions(process.argv.slice(2));
  if (options.help) return printHelp();

  const configuredUrl = options.url || (await readConfig())?.workerUrl;
  if (!configuredUrl) {
    throw new Error(
      "缺少 Worker 地址。先运行 gemini-github-mcp setup，或传入 --url https://<worker>.<subdomain>.workers.dev",
    );
  }
  const origin = normalizeBaseUrl(configuredUrl);

  const response = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: options.name,
      redirect_uris: [options.redirectUri],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.client_id !== "string") {
    const detail =
      body.error_description || body.error || "服务端未返回 client_id";
    throw new Error(`注册失败（HTTP ${response.status}）：${detail}`);
  }

  const serverSecret =
    typeof body.client_secret === "string" ? body.client_secret : "";
  const clientSecret = serverSecret || randomBytes(32).toString("hex");

  console.log(`
OAuth 客户端已注册

客户端 ID：
${body.client_id}

客户端密钥：
${clientSecret}

重定向 URI：
${options.redirectUri}

把客户端 ID 和客户端密钥填入 Gemini 的“连接到 MCP 服务器”弹窗。
${serverSecret ? "" : "\n注意：当前 Worker 未返回 client_secret，已生成本地密钥；旧版 Worker 不校验该值。\n"}
`);
}

main().catch((error) => {
  console.error(`\n注册失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
