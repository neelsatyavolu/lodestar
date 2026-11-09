import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { post } from "@/lib/client";
import { Button } from "./ui";

export type Provider = "codex" | "grok";
export const PROVIDER_NAME: Record<Provider, string> = { codex: "ChatGPT", grok: "Grok" };

const HOW: Record<Provider, string> = {
  codex: "Sign in with your ChatGPT account. You'll land on a page that doesn't load (a localhost address). That's expected: copy the full address from the address bar and paste it below.",
  grok: "Sign in with your X / Grok account. Grok then shows a code. Copy it and paste it below.",
};

export function ConnectAI({ open, onClose, onConnected, signedIn, initial = "codex" }: { open: boolean; onClose: () => void; onConnected: (p: Provider) => void; signedIn: boolean; initial?: Provider }) {
  const [provider, setProvider] = useState<Provider>(initial);
  const [started, setStarted] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const reset = (p: Provider) => {
    setProvider(p);
    setStarted(false);
    setPasted("");
    setError(null);
  };

  const start = async () => {
    setError(null);
    // Open the tab synchronously so popup blockers allow it, then point it at the sign-in URL.
    const tab = window.open("about:blank", "_blank");
    try {
      const { authorizeUrl } = await post<{ authorizeUrl: string }>(`/api/ai/${provider}/start`, {});
      if (tab) tab.location.href = authorizeUrl;
      else window.open(authorizeUrl, "_blank", "noopener");
      setStarted(true);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/ai/${provider}/complete`, { callback: pasted });
      onConnected(provider);
      reset(provider);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border border-hairline-strong bg-card p-0 text-ink backdrop:bg-scrim">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <h2 className="text-base font-medium">Connect an AI account</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-ash hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-5 p-5">
        <p className="text-[13px] leading-relaxed text-mute">
          Lodestar&apos;s AI runs on your own ChatGPT or Grok subscription.{" "}
          {signedIn
            ? "The sign-in token is encrypted and saved to your Lodestar account, so it works wherever you sign in. Disconnect to remove it."
            : "The sign-in token is encrypted and kept only in this browser’s cookies. Sign in to Lodestar first to save it to your account."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["codex", "grok"] as Provider[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => reset(p)}
              className={`h-11 cursor-pointer rounded-md border text-sm ${provider === p ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"}`}
            >
              {PROVIDER_NAME[p]}
            </button>
          ))}
        </div>
        <ol className="space-y-4 text-[13px]">
          <li className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline-strong text-[12px] text-charcoal">1</span>
            <div className="space-y-2">
              <p className="text-body">{HOW[provider]}</p>
              <Button size="sm" onClick={start}>
                Open {PROVIDER_NAME[provider]} sign-in <ExternalLink size={12} />
              </Button>
            </div>
          </li>
          <li className={`flex gap-3 ${started ? "" : "opacity-50"}`}>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline-strong text-[12px] text-charcoal">2</span>
            <div className="flex-1 space-y-2">
              <label htmlFor="ai-callback" className="block text-body">
                Paste the {provider === "codex" ? "address" : "code"} here
              </label>
              <input
                id="ai-callback"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                disabled={!started}
                placeholder={provider === "codex" ? "http://localhost:1455/auth/callback?code=…" : "Code from Grok"}
                className="h-10 w-full rounded-md border border-hairline-hover bg-card px-3 font-mono text-[13px] text-ink outline-none placeholder:text-mute focus:border-ink"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </li>
        </ol>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!started || !pasted.trim() || busy} onClick={finish}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
