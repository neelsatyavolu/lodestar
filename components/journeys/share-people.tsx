import { Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "@/lib/client";
import { Button, Toggle } from "../ui";
import { errorText } from "./shared";

// People the trip is shared with by email. Editors see and change everything,
// confirmations and prices included; viewers see the plan without them. Only
// the owner sees this list.

type Member = { id: string; email: string; canEdit: boolean; joined: boolean; name: string | null };

export function SharePeople({ journeyId }: { journeyId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [canEdit, setCanEdit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const base = `/api/journeys/${journeyId}/members`;

  useEffect(() => {
    let alive = true;
    api<{ members: Member[] }>(base)
      .then((r) => alive && setMembers(r.members))
      .catch((err) => alive && setError(errorText(err, "Couldn't load who it's shared with.")));
    return () => {
      alive = false;
    };
  }, [base]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      const { member } = await post<{ member: Member }>(base, { email, canEdit });
      setMembers((m) => [...(m ?? []).filter((x) => x.id !== member.id), member]);
      setSent(member.email);
      setEmail("");
    }, "Couldn't send the invite.");
  const change = (m: Member, edit: boolean) =>
    run(async () => {
      await api(`${base}/${m.id}`, { method: "PATCH", body: JSON.stringify({ canEdit: edit }) });
      setMembers((all) => (all ?? []).map((x) => (x.id === m.id ? { ...x, canEdit: edit } : x)));
    }, "Couldn't change that.");
  const remove = (m: Member) =>
    run(async () => {
      await api(`${base}/${m.id}`, { method: "DELETE" });
      setMembers((all) => (all ?? []).filter((x) => x.id !== m.id));
    }, "Couldn't remove them.");

  return (
    <section className="space-y-3">
      <h3 className="text-[13px] font-medium text-ink">Invite by email</h3>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite();
        }}
      >
        <div className="flex gap-2">
          <input
            id="share-email"
            type="email"
            value={email}
            onChange={(e) => (setEmail(e.target.value), setSent(null))}
            placeholder="name@example.com"
            autoComplete="email"
            aria-label="Email address"
            className="h-10 min-w-0 flex-1 rounded-md border border-hairline-hover bg-card px-3 text-[14px] text-ink outline-none placeholder:text-mute focus:border-accent max-sm:h-12"
          />
          <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
            <UserPlus size={14} /> Invite
          </Button>
        </div>
        <Toggle checked={canEdit} onChange={setCanEdit} label="Can edit" />
        <p className="text-[12px] text-mute">{canEdit ? "They see and change everything, confirmation numbers and prices included." : "They see the plan. Confirmation numbers, prices and the budget stay private."}</p>
      </form>
      {sent && <p className="text-[12px] text-ok">Invite sent to {sent}. The link works once and lasts 14 days.</p>}
      {members && members.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline-strong">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-ink">{m.name ?? m.email}</p>
                <p className="truncate text-[12px] text-mute">{[m.name ? m.email : null, m.joined ? null : "Invited, hasn't joined yet"].filter(Boolean).join(" · ")}</p>
              </div>
              <select
                aria-label={`What ${m.email} can do`}
                value={m.canEdit ? "edit" : "view"}
                disabled={busy}
                onChange={(e) => change(m, e.target.value === "edit")}
                className="h-8 cursor-pointer rounded-md border border-hairline-hover bg-card px-2 text-[13px] text-ink outline-none pointer-coarse:h-11"
              >
                <option value="edit">Can edit</option>
                <option value="view">View only</option>
              </select>
              <button type="button" onClick={() => remove(m)} disabled={busy} aria-label={`Remove ${m.email}`} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger pointer-coarse:size-11">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </section>
  );
}
