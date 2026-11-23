#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { normalizeBaseUrl, parseVerifyOptions, readConfig } from "./lib.mjs";

function printHelp() {
  console.log(`
Gemini GitHub MCP Proxy 部署验收

用法：
  gemini-github-mcp verify
  gemini-github-mcp verify --url https://<worker>.<subdomain>.workers.dev
  gemini-github-mcp verify --url=https://<worker>.<subdomain>.workers.dev/mcp

默认读取本机最近一次 setup 保存的部署地址，也可通过 MCP_URL 环境变量或 --url 指定。
`);
}

export async function verifyDeployment(baseUrl) {
  const origin = normalizeBaseUrl(baseUrl);
  const checks = [];

  async function request(path, init = {}, expected = 200) {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== expected) {
      const body = await response.text();
      throw new Error(
        `${path} 返回 ${response.status}，预期 ${expected}${body ? `：${body.slice(0, 300)}` : ""}`,
      );
    }
    checks.push(`${path} → ${response.status}`);
    return response;
  }

  const health = await request("/health");
  const healthBody = await health.json();
  if (healthBody.status !== "ok") {
    throw new Error("Worker 健康检查未通过；请确认三个 Secret 已设置。");
  }

  const resourceResponse = await request("/.well-known/oauth-protected-resource");
  const resource = await resourceResponse.json();
  if (resource.resource !== `${origin}/mcp`) {
    throw new Error("OAuth Protected Resource metadata 的 resource 地址不正确。");
  }

  const metadataResponse = await request("/.well-known/oauth-authorization-server");
  const metadata = await metadataResponse.json();
  if (
    metadata.issuer !== origin ||
    metadata.registration_endpoint !== `${origin}/register`
  ) {
    throw new Error("OAuth Authorization Server metadata 不完整。");
  }

  const unauthorized = await request(
    "/mcp",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    401,
  );
  if (!unauthorized.headers.get("www-authenticate")?.includes("oauth-protected-resource")) {
    throw new Error("未认证 MCP 响应缺少 OAuth discovery challenge。");
  }

  const registrationResponse = await request(
    "/register",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "gemini-github-mcp-proxy verification",
        redirect_uris: [
          "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-verification",
        ],
      }),
    },
    201,
  );
  const registration = await registrationResponse.json();
  if (typeof registration.client_id !== "string") {
    throw new Error("动态客户端注册未返回 client_id。");
  }

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    checks,
  };
}

async function main() {
  const options = parseVerifyOptions(process.argv.slice(2));
  if (options.help) return printHelp();

  const configuredUrl =
    options.url ||
    process.env.MCP_URL ||
    (await readConfig())?.workerUrl;
  if (!configuredUrl) {
    throw new Error(
      "缺少部署地址。先运行 gemini-github-mcp setup，或执行 gemini-github-mcp verify --url https://<worker>.<subdomain>.workers.dev",
    );
  }

  const result = await verifyDeployment(configuredUrl);
  console.log(`\n部署验收通过：${result.mcpUrl}`);
  for (const check of result.checks) console.log(`  ✓ ${check}`);
}

function isDirectEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]).toLowerCase() ===
      realpathSync(new URL(import.meta.url)).toLowerCase()
    );
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isDirectEntrypoint()) {
  main().catch((error) => {
    console.error(`\n验收失败：${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
