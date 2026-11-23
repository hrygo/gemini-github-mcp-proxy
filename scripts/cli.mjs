#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTOR_NAME, configPath, readConfig } from "./lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scripts = {
  setup: "setup.mjs",
  verify: "verify.mjs",
};

function help() {
  console.log(`
Gemini GitHub MCP Proxy

用法：
  gemini-github-mcp setup                         一键部署（未登录 Cloudflare 时自动引导登录）
  gemini-github-mcp setup --tools all             恢复开放全部 GitHub MCP 工具（不重置 PIN）
  gemini-github-mcp setup --tools tool_a,tool_b   调整暴露给 Gemini 的工具集（不重置 PIN）
  gemini-github-mcp setup --rotate                轮换 PAT、PIN 与签名密钥并重新部署
  gemini-github-mcp login                         登录或切换 Cloudflare 账号（使用内置 Wrangler）
  gemini-github-mcp verify                        验收当前部署
  gemini-github-mcp verify --url https://<worker>.workers.dev
  gemini-github-mcp status                        查看本机部署配置与线上健康状态

从 GitHub 安装：
  npm install --global --allow-scripts=esbuild,fsevents,workerd https://github.com/hrygo/gemini-github-mcp-proxy/releases/latest/download/gemini-github-mcp-proxy.tgz

首次使用前：
  1. Node.js 22+
  2. Cloudflare 账号（运行 setup 时会自动打开浏览器登录）
  3. 准备 fine-grained GitHub PAT：https://github.com/settings/personal-access-tokens/new
`);
}

async function runBundledWrangler(wranglerArgs) {
  const require = createRequire(import.meta.url);
  const wranglerPackagePath = require.resolve("wrangler/package.json");
  const wranglerPackage = JSON.parse(await readFile(wranglerPackagePath, "utf8"));
  const wranglerBin = join(
    dirname(wranglerPackagePath),
    wranglerPackage.bin.wrangler,
  );
  const child = spawn(process.execPath, [wranglerBin, ...wranglerArgs], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
}

async function showStatus() {
  const config = await readConfig();
  if (!config?.workerUrl) {
    console.log(`尚未找到本机部署配置（${configPath()}）。\n请先运行：gemini-github-mcp setup`);
    return;
  }

  console.log("\nGemini GitHub MCP Proxy 当前状态\n");
  console.log(`  Connector 名称：${CONNECTOR_NAME}`);
  console.log(`  MCP URL：${config.mcpUrl || `${config.workerUrl}/mcp`}`);
  console.log(
    `  工具范围：${config.upstreamTools === "all" || !config.upstreamTools ? "全部（默认透传）" : config.upstreamTools}`,
  );
  if (config.configuredAt) {
    console.log(`  最近部署：${config.configuredAt}`);
  }
  console.log(`  配置文件：${configPath()}`);

  try {
    const response = await fetch(`${config.workerUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.status === "ok") {
      console.log("  线上状态：✓ 正常（/health → ok）\n");
    } else {
      console.log(`  线上状态：✗ 异常（HTTP ${response.status}）\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(
      `  线上状态：✗ 无法连接（${error instanceof Error ? error.message : error}）\n`,
    );
    process.exitCode = 1;
  }
}

const args = process.argv.slice(2);
const command = args.shift() || "setup";

if (command === "--help" || command === "-h" || command === "help") {
  help();
  process.exit(0);
}
if (command === "--version" || command === "-v" || command === "version") {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}
if (command === "login") {
  await runBundledWrangler(["login", ...args]);
} else if (command === "status") {
  await showStatus();
} else {
  const script = scripts[command];
  if (!script) {
    console.error(`未知命令：${command}\n`);
    help();
    process.exit(1);
  }

  const scriptPath = fileURLToPath(new URL(script, import.meta.url));
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
}
