import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function configPath() {
  if (process.env.GEMINI_GITHUB_MCP_CONFIG_DIR) {
    return join(process.env.GEMINI_GITHUB_MCP_CONFIG_DIR, "config.json");
  }
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "gemini-github-mcp-proxy",
      "config.json",
    );
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "gemini-github-mcp-proxy",
      "config.json",
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "gemini-github-mcp-proxy",
    "config.json",
  );
}

export function normalizeBaseUrl(input) {
  const url = new URL(input);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("MCP URL 必须使用 HTTPS；仅本机开发可使用 HTTP。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("MCP URL 不能包含用户名、密码、查询参数或片段。");
  }
  if (url.pathname !== "/" && url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
    throw new Error("MCP URL 只支持 Worker 根路径或 /mcp。");
  }
  return url.origin;
}

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeConfig(config) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}

export function findWorkersDevUrl(output) {
  const matches = output.match(/https:\/\/[^\s"'<>]+\.workers\.dev(?:\/[^\s"'<>]*)?/g);
  return matches?.at(-1)?.replace(/[),.;]+$/, "") ?? null;
}
