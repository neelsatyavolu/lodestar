import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { putClient } from "../db/agent-auth";
import { createPgliteDb, type Db } from "../db/client";
import { migrate } from "../db/schema";
import { checkAuthorize } from "./authorize";
import { guardedLookup, metadataUrl } from "./clients";
import { isBlockedAddress } from "./ip";
import { authServerMetadata, validResource } from "./metadata";
import { matchRedirect, validRedirect } from "./redirect";
import { hashToken, kindOf, newToken, verifyPkce } from "./tokens";

const ORIGIN = "https://lodestar.example";

describe("tokens", () => {
  it("are prefixed by kind, random, and stored only as a hash", () => {
    const a = newToken("access");
    expect(a).toMatch(/^lsa_[\w-]{43}$/);
    expect(newToken("access")).not.toBe(a);
    expect(kindOf(a)).toBe("access");
    expect(kindOf(newToken("personal"))).toBe("personal");
    expect(kindOf("lsa_short")).toBeNull();
    expect(kindOf("Bearer something")).toBeNull();
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(4, 20));
  });
});

describe("PKCE", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the verifier that made the challenge", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("refuses any other verifier, a plain challenge, or malformed input", () => {
    expect(verifyPkce(randomBytes(32).toString("base64url"), challenge)).toBe(false);
    expect(verifyPkce(verifier, verifier.slice(0, 43))).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
    expect(verifyPkce(verifier, "")).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https, loopback http and app schemes", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/callback", "http://localhost/cb", "http://[::1]:8080/cb", "cursor://anysphere.cursor-retrieval/oauth/callback"]) expect(validRedirect(ok)).toBe(true);
  });

  it("refuses plain http elsewhere, fragments, credentials and dangerous schemes", () => {
    for (const bad of ["http://example.com/cb", "https://example.com/cb#x", "https://user:pw@example.com/cb", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url"]) expect(validRedirect(bad)).toBe(false);
  });

  it("matches exactly, except a loopback port may change", () => {
    const registered = ["https://claude.ai/cb", "http://127.0.0.1:1234/callback"];
    expect(matchRedirect("https://claude.ai/cb", registered)).toBe("https://claude.ai/cb");
    expect(matchRedirect("https://claude.ai/cb/", registered)).toBeNull();
    expect(matchRedirect("https://claude.ai/cb?x=1", registered)).toBeNull();
    expect(matchRedirect("http://127.0.0.1:9999/callback", registered)).toBe("http://127.0.0.1:9999/callback");
    expect(matchRedirect("http://127.0.0.1:9999/other", registered)).toBeNull();
    expect(matchRedirect("http://localhost:1234/callback", registered)).toBeNull();
  });
});

describe("the address guard for client metadata documents", () => {
  it("blocks private, loopback, link-local, metadata and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "ff02::1", "nonsense"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "160.79.104.10", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("only fetches https URLs on a real host name", () => {
    expect(metadataUrl("https://claude.ai/oauth/claude-code-client-metadata")?.href).toBe("https://claude.ai/oauth/claude-code-client-metadata");
    for (const bad of ["http://claude.ai/meta", "https://claude.ai/", "https://claude.ai:8443/meta", "https://10.0.0.1/meta", "https://[::1]/meta", "https://localhost/meta", "https://u:p@claude.ai/meta", "https://claude.ai/meta#x", "ftp://claude.ai/meta"]) expect(metadataUrl(bad), bad).toBeNull();
  });
});

describe("metadata", () => {
  it("advertises PKCE-only public clients, both registration styles and this origin as issuer", () => {
    const m = authServerMetadata(`${ORIGIN}/`);
    expect(m).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/api/oauth/token`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], client_id_metadata_document_supported: true });
  });

  it("accepts a resource indicator naming the MCP endpoint or the origin", () => {
    expect(validResource(null, ORIGIN)).toBe(true);
    expect(validResource(`${ORIGIN}/api/mcp`, ORIGIN)).toBe(true);
    expect(validResource(`${ORIGIN}/api/mcp/`, ORIGIN)).toBe(true);
    expect(validResource(ORIGIN, ORIGIN)).toBe(true);
    expect(validResource("https://evil.example/api/mcp", ORIGIN)).toBe(false);
  });
});

describe("checking an authorization request", () => {
  let db: Db;
  const clientId = "00000000-0000-4000-8000-0000000000c1";
  const challenge = createHash("sha256").update("v".repeat(43)).digest("base64url");
  const base = { response_type: "code", client_id: clientId, redirect_uri: "https://claude.ai/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1" };

  beforeEach(async () => {
    db = await createPgliteDb();
    await migrate(db);
    await putClient(db, { id: clientId, name: "Claude", redirectUris: ["https://claude.ai/cb"], kind: "dcr" }, 0);
  });

  it("accepts a complete PKCE request", async () => {
    const r = await checkAuthorize(db, base, ORIGIN, 1);
    expect(r).toMatchObject({ kind: "ok", request: { redirectUri: "https://claude.ai/cb", challenge, state: "s1", client: { name: "Claude" } } });
  });

  it("shows problems with the client or redirect on the page instead of redirecting", async () => {
    expect((await checkAuthorize(db, { ...base, client_id: "00000000-0000-4000-8000-0000000000ff" }, ORIGIN, 1)).kind).toBe("show");
    expect((await checkAuthorize(db, { ...base, client_id: "not-a-client" }, ORIGIN, 1)).kind).toBe("show");
    expect((await checkAuthorize(db, { ...base, redirect_uri: "https://evil.example/cb" }, ORIGIN, 1)).kind).toBe("show");
  });

  it("sends other problems back to the client as OAuth errors with state and iss", async () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ code_challenge: undefined }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "admin" }, "invalid_scope"],
      [{ resource: "https://evil.example/api/mcp" }, "invalid_target"],
    ];
    for (const [over, error] of cases) {
      const r = await checkAuthorize(db, { ...base, ...over }, ORIGIN, 1);
      expect(r.kind).toBe("redirect");
      const url = new URL((r as { url: string }).url);
      expect([url.origin + url.pathname, url.searchParams.get("error"), url.searchParams.get("state"), url.searchParams.get("iss")]).toEqual(["https://claude.ai/cb", error, "s1", ORIGIN]);
    }
    expect((await checkAuthorize(db, { ...base, repeated: true }, ORIGIN, 1)).kind).toBe("redirect");
  });
});

describe("fetching a client's metadata document", () => {
  it("refuses at connect time a host that resolves to a private address", async () => {
    const result = await new Promise<{ err: Error | null }>((resolve) => guardedLookup("localhost", {}, (err) => resolve({ err })));
    expect(result.err?.message).toBe("The client's address can't be reached.");
  });
});
