import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/client";
import { Dialog } from "../dialog";
import { Button, Toggle } from "../ui";
import { SharePeople } from "./share-people";
import { errorText } from "./shared";

// A read-only link for the people going: anyone with it can see the plan,
// without confirmation numbers, prices or the budget. Turning it off kills the
// link; turning it on again makes a new one.

export function ShareDialog({ open, onClose, journeyId, token, onToken }: { open: boolean; onClose: () => void; journeyId: string; token: string | null; onToken: (t: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/t/${token}` : null;

  const set = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ url: string | null }>(`/api/journeys/${journeyId}/share`, { on });
      onToken(r.url ? (r.url.split("/t/")[1] ?? null) : null);
    } catch (err) {
      setError(errorText(err, "Couldn't change sharing."));
    } finally {
      setBusy(false);
    }
  };
  const copy = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Share this trip" width={520}>
      <div className="space-y-4 p-5">
        {open && <SharePeople journeyId={journeyId} />}
        <h3 className="border-t border-hairline pt-4 text-[13px] font-medium text-ink">Link</h3>
        <p className="text-[14px] leading-relaxed text-body">Anyone with the link can see the plan: the days, what&apos;s booked and what still needs booking, the checklist and notes. Confirmation numbers, prices and the budget stay private.</p>
        <Toggle checked={Boolean(token)} onChange={(on) => !busy && set(on)} label={token ? "Link is on" : "Link is off"} />
        {url && (
          <div className="flex gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-hairline-hover bg-card px-3 pointer-coarse:h-11">
              <Link2 size={14} className="shrink-0 text-ash" aria-hidden />
              <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none" />
            </div>
            <Button variant="primary" onClick={copy} className="!h-auto">
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        {token && <p className="text-[12px] text-mute">Turn the link off to stop it working. A new link is made if you turn it on again.</p>}
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
