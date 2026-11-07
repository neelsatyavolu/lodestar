import { Check, Copy, KeyRound, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, post } from "@/lib/client";
import type { Grant } from "@/lib/db/agent-auth";
import { Dialog, inputClass } from "./dialog";
import { Button, Spinner } from "./ui";

// Agents: connect Claude, ChatGPT, Codex or any MCP client to Lodestar Trips.
// Apps sign in with OAuth and show up here to disconnect; CLIs that can't do
// OAuth use a personal token, shown once.

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-hairline-strong bg-deep py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-body">{text}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} title="Copy" className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-ash hover:text-ink">
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">{name}</h3>
      <div className="mt-1.5 space-y-2 text-[13px] text-mute">{children}</div>
    </div>
  );
}

export function AgentAccess({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ mcpUrl: string; grants: Grant[] }>("/api/agents")
      .then((r) => {
        setMcpUrl(r.mcpUrl);
        setGrants(r.grants);
      })
      .catch((err) => setError(errorText(err, "Couldn't load your connections.")));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ grant: Grant; token: string }>("/api/agents", { name: name.trim() });
      setFresh(r.token);
      setName("");
      setGrants((g) => [r.grant, ...g]);
    } catch (err) {
      setError(errorText(err, "Couldn't make a token."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (g: Grant) => {
    if (!window.confirm(g.kind === "oauth" ? `Disconnect ${g.name}? It will stop working on your trips.` : `Delete the token “${g.name}”? Anything using it stops working.`)) return;
    try {
      await api(`/api/agents/${g.id}`, { method: "DELETE" });
      setGrants((all) => all.filter((x) => x.id !== g.id));
    } catch (err) {
      setError(errorText(err, "Couldn't revoke it."));
    }
  };

  const apps = grants.filter((g) => g.kind === "oauth");
  const tokens = grants.filter((g) => g.kind === "personal");
  const url = mcpUrl ?? "";

  return (
    <Dialog open={open} onClose={onClose} title="Agents" width={600}>
      <div className="space-y-7 px-5 py-5">
        <p className="text-[14px] leading-relaxed text-body">
          Let Claude, ChatGPT, Codex or any MCP client read and plan your trips: build itineraries, fill the To book list, the checklist, notes and the budget.
        </p>

        <section className="space-y-4">
          <Step name="Server address">{url ? <CopyText text={url} label="server address" /> : <Spinner />}</Step>
          <Step name="Claude Code">{url && <CopyText text={`claude mcp add --transport http lodestar ${url}`} label="Claude Code command" />}<p>Then run /mcp and sign in when it asks.</p></Step>
          <Step name="Claude or ChatGPT (web and desktop)">
            <p>Add a custom connector with the server address above. You&apos;ll be sent here to sign in and allow it.</p>
          </Step>
          <Step name="Codex, scripts and other clients">
            <p>
              Use OAuth if the client supports it. Otherwise make a personal token below and send it as <code className="font-mono text-[12px] text-body">Authorization: Bearer lsp_…</code>.
            </p>
          </Step>
        </section>

        <section>
          <h3 className="flex items-center gap-2 border-b border-hairline pb-2 text-[13px] font-medium text-ink">
            <Plug size={14} className="text-accent" aria-hidden /> Connected apps
          </h3>
          {apps.length === 0 ? (
            <p className="py-3 text-[13px] text-ash">Nothing connected yet.</p>
          ) : (
            <ul>
              {apps.map((g) => (
                <li key={g.id} className="flex items-center gap-3 border-b border-hairline py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-ink">{g.name}</p>
                    <p className="text-[12px] text-ash">Connected {when(g.createdAt)} · last used {when(g.lastUsedAt)}</p>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => revoke(g)}>
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="flex items-center gap-2 border-b border-hairline pb-2 text-[13px] font-medium text-ink">
            <KeyRound size={14} className="text-accent" aria-hidden /> Personal tokens
          </h3>
          {fresh && (
            <div className="mt-3 rounded-md border border-hairline-strong bg-elevated p-3">
              <p className="mb-2 text-[13px] text-ink">Copy it now. It won&apos;t be shown again.</p>
              <CopyText text={fresh} label="token" />
            </div>
          )}
          {tokens.length > 0 && (
            <ul>
              {tokens.map((g) => (
                <li key={g.id} className="flex items-center gap-3 border-b border-hairline py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-ink">{g.name}</p>
                    <p className="text-[12px] text-ash">Made {when(g.createdAt)} · last used {when(g.lastUsedAt)}</p>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => revoke(g)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Codex on my laptop" maxLength={60} aria-label="Token name" className={inputClass} />
            <Button type="submit" disabled={busy || !name.trim()} className="max-sm:h-12">
              {busy ? <Spinner /> : null} Make token
            </Button>
          </form>
        </section>

        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
