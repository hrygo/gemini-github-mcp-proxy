import { describe, expect, it } from "vitest";
import worker, {
  DEFAULT_UPSTREAM_TOOLS,
  normalizeGitHubMcpContent,
  normalizeGitHubMcpJson,
  normalizeGitHubMcpSseLine,
} from "../src/index";

const env = {
  GITHUB_PAT: "test-pat",
  ADMIN_PIN: "123456",
  SIGNING_SECRET: "test-signing-secret",
  ALLOWED_REDIRECT_PREFIX:
    "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-",
  UPSTREAM_MCP_URL: "https://example.invalid/mcp/",
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://proxy.example${path}`, init), env) as Promise<Response>;
}

function getRedirectLocation(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("Missing Location header");
  return new URL(location);
}

describe("Gemini GitHub MCP proxy", () => {
  it("reports health from configuration", async () => {
    const response = await call("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("publishes OAuth metadata", async () => {
    const response = await call("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: "https://proxy.example",
      authorization_endpoint: "https://proxy.example/authorize",
      token_endpoint: "https://proxy.example/token",
      registration_endpoint: "https://proxy.example/register",
    });
  });

  it("supports dynamic client registration", async () => {
    const response = await call("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Gemini",
        redirect_uris: ["https://oauth-redirect.googleusercontent.com/r/test"],
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      client_name: "Gemini",
      token_endpoint_auth_method: "client_secret_post",
    });
  });

  it("rejects unauthenticated MCP requests", async () => {
    const response = await call("/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("completes authorization-code and refresh-token flows", async () => {
    const verifier = "test-verifier-with-enough-entropy";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const form = new URLSearchParams({
      client_id: "mcp-client-test",
      redirect_uri: redirectUri,
      state: "test-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "repo",
      pin: env.ADMIN_PIN,
    });

    const authorize = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    expect(authorize.status).toBe(302);
    const location = getRedirectLocation(authorize);
    expect(location.searchParams.get("state")).toBe("test-state");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await call("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        code_verifier: verifier,
        client_id: "mcp-client-test",
      }),
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.refresh_token).toBeTruthy();

    const refreshed = await call("/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()) as { access_token: string }).toHaveProperty(
      "access_token",
    );
  });

  it("rejects invalid PINs and redirect URIs", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const badPin = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ redirect_uri: redirectUri, pin: "000000" }),
    });
    expect(badPin.status).toBe(401);

    const badRedirect = await call(
      `/authorize?redirect_uri=${encodeURIComponent("https://evil.example/callback")}`,
    );
    expect(badRedirect.status).toBe(400);
  });

  it("serves the authorization form with hardened response headers", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const response = await call(
      `/authorize?client_id=mcp-client-test&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=test&code_challenge_method=S256`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).toContain("授权 PIN");
  });

  it("flattens GitHub text resources so Gemini can read file bodies", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [
          {
            type: "text",
            text: "successfully downloaded text file (SHA: abc123)",
          },
          {
            type: "resource",
            resource: {
              uri: "repo://owner/repo/contents/README.md",
              mimeType: "text/plain; charset=utf-8",
              text: "# Project\n\nFirst paragraph.\n",
            },
          },
        ],
      },
    };

    expect(normalizeGitHubMcpContent(payload)).toMatchObject({
      result: {
        content: [
          { type: "text", text: "successfully downloaded text file (SHA: abc123)" },
          { type: "text", text: "# Project\n\nFirst paragraph.\n" },
        ],
      },
    });
  });

  it("normalizes both JSON and SSE MCP payloads", () => {
    const payload = JSON.stringify({
      result: {
        content: [
          {
            type: "resource",
            resource: { mimeType: "text/plain", text: "file body" },
          },
        ],
      },
    });

    expect(JSON.parse(normalizeGitHubMcpJson(payload))).toMatchObject({
      result: { content: [{ type: "text", text: "file body" }] },
    });
    expect(normalizeGitHubMcpSseLine(`data: ${payload}\n`)).toContain(
      '"type":"text","text":"file body"',
    );
  });

  it("exposes development tools without repository-destructive operations", () => {
    const tools = DEFAULT_UPSTREAM_TOOLS.split(",");
    expect(tools).toEqual(
      expect.arrayContaining([
        "get_file_contents",
        "create_branch",
        "push_files",
        "create_pull_request",
        "issue_write",
        "add_issue_comment",
      ]),
    );
    expect(tools).not.toEqual(
      expect.arrayContaining([
        "delete_file",
        "merge_pull_request",
        "create_repository",
        "fork_repository",
      ]),
    );
  });
});
