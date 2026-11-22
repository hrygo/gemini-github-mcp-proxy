import { describe, expect, it } from "vitest";
import { findWorkersDevUrl, normalizeBaseUrl } from "../scripts/lib.mjs";

describe("setup helpers", () => {
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
});
