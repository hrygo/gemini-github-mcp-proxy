import { describe, expect, it } from "vitest";
import {
  CONNECTOR_NAME,
  extractJsonObject,
  findWorkersDevUrl,
  isSubdomainSetupError,
  normalizeBaseUrl,
  normalizeToolSelection,
  parseSetupOptions,
  parseVerifyOptions,
  sanitizeGitHubPat,
} from "../scripts/lib.mjs";

describe("setup helpers", () => {
  it("keeps the connector name a single mention-safe token", () => {
    expect(CONNECTOR_NAME).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("accepts root and MCP URLs and returns the Worker origin", () => {
    expect(normalizeBaseUrl("https://example.workers.dev")).toBe(
      "https://example.workers.dev",
    );
    expect(normalizeBaseUrl("https://example.workers.dev/mcp")).toBe(
      "https://example.workers.dev",
    );
  });

  it("rejects insecure remote URLs", () => {
    expect(() => normalizeBaseUrl("http://example.com/mcp")).toThrow(
      "必须使用 HTTPS",
    );
  });

  it("extracts the deployed workers.dev URL", () => {
    const output = `
Deployed gemini-github-mcp-proxy triggers
  https://gemini-github-mcp-proxy.friend.workers.dev
`;
    expect(findWorkersDevUrl(output)).toBe(
      "https://gemini-github-mcp-proxy.friend.workers.dev",
    );
  });

  it("extracts JSON objects even when surrounded by CLI notices", () => {
    const noisy = `⛅️ wrangler 4.166.0\n{"loggedIn":true,"accounts":[{"id":"acc-1","name":"Me"}]}\n`;
    expect(extractJsonObject(noisy)).toEqual({
      loggedIn: true,
      accounts: [{ id: "acc-1", name: "Me" }],
    });
    expect(extractJsonObject("not json at all")).toBeNull();
  });

  it("sanitizes pasted GitHub PATs with quotes, whitespace, or Bearer prefix", () => {
    expect(sanitizeGitHubPat("  github_pat_1234567890abcdef  ")).toBe(
      "github_pat_1234567890abcdef",
    );
    expect(sanitizeGitHubPat('"github_pat_1234567890abcdef"')).toBe(
      "github_pat_1234567890abcdef",
    );
    expect(sanitizeGitHubPat("Bearer ghp_1234567890abcdef1234")).toBe(
      "ghp_1234567890abcdef1234",
    );
  });

  it("detects Cloudflare missing workers.dev subdomain errors", () => {
    expect(
      isSubdomainSetupError(
        "In a non-interactive environment, it's necessary to set a workers.dev subdomain",
      ),
    ).toBe(true);
    expect(isSubdomainSetupError("Authentication error")).toBe(false);
  });

  it("defaults to the full upstream tool surface", () => {
    expect(normalizeToolSelection(undefined)).toBeNull();
    expect(normalizeToolSelection("")).toBeNull();
    expect(normalizeToolSelection("all")).toBeNull();
  });

  it("accepts an explicit tool selection", () => {
    expect(
      normalizeToolSelection(" get_file_contents, delete_file,get_file_contents "),
    ).toBe("get_file_contents,delete_file");
    expect(() => normalizeToolSelection("get_file_contents,../bad")).toThrow(
      "只能包含逗号分隔的工具名",
    );
  });

  it("parses setup flags strictly", () => {
    expect(parseSetupOptions([])).toEqual({
      help: false,
      rotate: false,
      tools: undefined,
    });
    expect(parseSetupOptions(["--rotate", "--tools", "all"])).toEqual({
      help: false,
      rotate: true,
      tools: "all",
    });
    expect(parseSetupOptions(["--tools=get_file_contents,delete_file"])).toEqual({
      help: false,
      rotate: false,
      tools: "get_file_contents,delete_file",
    });
    expect(() => parseSetupOptions(["--tool", "delete_file"])).toThrow(
      "未知参数",
    );
    expect(() => parseSetupOptions(["--tools"])).toThrow("缺少参数值");
    expect(() => parseSetupOptions(["--tools="])).toThrow("缺少参数值");
    expect(() => parseSetupOptions(["--tools", "all", "--tools", "all"])).toThrow(
      "只能指定一次",
    );
  });

  it("parses verify flags cleanly", () => {
    expect(parseVerifyOptions([])).toEqual({ help: false, url: undefined });
    expect(parseVerifyOptions(["--help"])).toEqual({ help: true, url: undefined });
    expect(parseVerifyOptions(["--url", "https://example.workers.dev"])).toEqual({
      help: false,
      url: "https://example.workers.dev",
    });
    expect(parseVerifyOptions(["--url=https://example.workers.dev/mcp"])).toEqual({
      help: false,
      url: "https://example.workers.dev/mcp",
    });
    expect(() => parseVerifyOptions(["--url"])).toThrow("缺少参数值");
    expect(() => parseVerifyOptions(["--unknown"])).toThrow("未知参数");
  });
});
