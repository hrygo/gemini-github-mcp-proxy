import { describe, expect, it, vi } from "vitest";
import worker, {
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

type TestEnv = typeof env & {
  AUTHORIZE_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
};

async function call(
  path: string,
  init: RequestInit = {},
  overrides: Partial<TestEnv> = {},
): Promise<Response> {
  return worker.fetch(new Request(`https://proxy.example${path}`, init), {
    ...env,
    ...overrides,
  }) as Promise<Response>;
}

function getRedirectLocation(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("Missing Location header");
  return new URL(location);
}

const testRedirectUri =
  "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";

async function registerClient(): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const response = await call("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Gemini",
      redirect_uris: [testRedirectUri],
    }),
  });
  const body = (await response.json()) as {
    client_id: string;
    client_secret: string;
  };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

async function authorizeCode(
  clientId: string,
  verifier: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const response = await call("/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: testRedirectUri,
      state: "test-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "repo",
      pin: env.ADMIN_PIN,
    }),
  });
  const location = getRedirectLocation(response);
  const code = location.searchParams.get("code");
  if (!code) throw new Error("Missing authorization code");
  return code;
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
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("supports dynamic client registration", async () => {
    const response = await call("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Gemini",
        redirect_uris: [
          "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test",
        ],
      }),
    });
    expect(response.status).toBe(201);
    const registration = (await response.json()) as Record<string, unknown>;
    expect(registration).toMatchObject({
      client_name: "Gemini",
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(typeof registration.client_id).toBe("string");
    expect(typeof registration.client_secret).toBe("string");
  });

  it("rejects unauthenticated MCP requests", async () => {
    const response = await call("/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("completes authorization-code and refresh-token flows", async () => {
    const { clientId, clientSecret } = await registerClient();
    const verifier = "test-verifier-with-enough-entropy";
    const code = await authorizeCode(clientId, verifier);

    const token = await call("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: clientId,
        client_secret: clientSecret,
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
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()) as { access_token: string }).toHaveProperty(
      "access_token",
    );
  });

  it("rejects an invalid client secret and accepts HTTP Basic credentials", async () => {
    const { clientId, clientSecret } = await registerClient();
    const verifier = "test-verifier-with-enough-entropy";

    const wrongSecretCode = await authorizeCode(clientId, verifier);
    const wrongSecret = await call("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: wrongSecretCode,
        code_verifier: verifier,
        client_id: clientId,
        client_secret: "wrong-secret",
      }),
    });
    expect(wrongSecret.status).toBe(401);
    expect(await wrongSecret.json()).toMatchObject({
      error: "invalid_client",
    });

    const basicCode = await authorizeCode(clientId, verifier);
    const basic = await call("/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: basicCode,
        code_verifier: verifier,
      }),
    });
    expect(basic.status).toBe(200);
  });

  it("rejects invalid PINs and redirect URIs", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const badPin = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        redirect_uri: redirectUri,
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
        pin: "000000",
      }),
    });
    expect(badPin.status).toBe(401);

    const badRedirect = await call(
      `/authorize?redirect_uri=${encodeURIComponent("https://evil.example/callback")}`,
    );
    expect(badRedirect.status).toBe(400);
  });

  it("rejects unsupported authorization methods", async () => {
    const response = await call("/authorize", { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  it("rate limits authorization attempts before PIN verification", async () => {
    const limiter = {
      limit: vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false }),
    };
    const form = new URLSearchParams({
      redirect_uri:
        "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test",
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      pin: "000000",
    });

    const allowed = await call(
      "/authorize",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
      { AUTHORIZE_RATE_LIMITER: limiter },
    );
    expect(allowed.status).toBe(401);

    const denied = await call(
      "/authorize",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
      { AUTHORIZE_RATE_LIMITER: limiter },
    );
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    expect(limiter.limit).toHaveBeenCalledWith({
      key: "203.0.113.7:authorize",
    });
  });

  it("requires S256 PKCE and rejects unsupported client credentials", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const missingPkce = await call(
      `/authorize?client_id=mcp-client-test&redirect_uri=${encodeURIComponent(redirectUri)}`,
    );
    expect(missingPkce.status).toBe(400);

    const plainPkce = await call(
      `/authorize?client_id=mcp-client-test&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${"A".repeat(43)}&code_challenge_method=plain`,
    );
    expect(plainPkce.status).toBe(400);

    const clientCredentials = await call("/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "mcp-client-test",
        client_secret: env.ADMIN_PIN,
      }),
    });
    expect(clientCredentials.status).toBe(400);
    expect(await clientCredentials.json()).toMatchObject({
      error: "unsupported_grant_type",
    });
  });

  it("rejects dynamic registration for untrusted callbacks", async () => {
    const response = await call("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Hostile",
        redirect_uris: ["https://evil.example/callback"],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_client_metadata",
    });
  });

  it("serves the authorization form with hardened response headers", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const response = await call(
      `/authorize?client_id=mcp-client-test&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${"A".repeat(43)}&code_challenge_method=S256`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const html = await response.text();
    expect(html).toContain("授权 PIN");
    expect(html).toContain("10 分钟内有效");
    expect(html).toContain('autocomplete="one-time-code"');

    const englishResponse = await call(
      `/authorize?client_id=mcp-client-test&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${"A".repeat(43)}&code_challenge_method=S256`,
      { headers: { "accept-language": "en-US,en;q=0.9" } },
    );
    expect(englishResponse.status).toBe(200);
    const englishHtml = await englishResponse.text();
    expect(englishHtml).toContain("Authorization PIN");
    expect(englishHtml).toContain("10 minutes");
  });

  it("accepts PINs pasted with accidental whitespace and shows recovery hint on wrong PIN", async () => {
    const redirectUri =
      "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test";
    const withSpaces = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "mcp-client-test",
        redirect_uri: redirectUri,
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
        pin: ` ${env.ADMIN_PIN.slice(0, 3)} ${env.ADMIN_PIN.slice(3)} `,
      }),
    });
    expect(withSpaces.status).toBe(302);

    const wrongPin = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        redirect_uri: redirectUri,
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
        pin: "000000",
      }),
    });
    expect(wrongPin.status).toBe(401);
    expect(await wrongPin.text()).toContain("gemini-github-mcp setup --pin-only");
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

  it("passes the full upstream tool surface through unless explicitly configured", async () => {
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
    const authorize = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "mcp-client-test",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        pin: env.ADMIN_PIN,
      }),
    });
    const code = getRedirectLocation(authorize).searchParams.get("code");
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
    const accessToken = ((await token.json()) as { access_token: string })
      .access_token;

    const upstreamRequests: Array<{
      init?: RequestInit;
      input: RequestInfo | URL;
    }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequests.push({ input, init });
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await call("/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      const defaultHeaders = upstreamRequests[0].init?.headers as Headers;
      expect(defaultHeaders.get("x-mcp-tools")).toBeNull();

      await worker.fetch(
        new Request("https://proxy.example/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
        { ...env, UPSTREAM_TOOLS: "get_file_contents,delete_file" },
      );
      const selectedHeaders = upstreamRequests[1].init?.headers as Headers;
      expect(selectedHeaders.get("x-mcp-tools")).toBe(
        "get_file_contents,delete_file",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
