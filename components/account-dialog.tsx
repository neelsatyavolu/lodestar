import { useState } from "react";
import { post } from "@/lib/client";
import type { Preferences } from "@/lib/preferences";
import { Dialog, Field, inputClass } from "./dialog";
import { Button } from "./ui";

export type Account = { email: string };
type Mode = "signin" | "register" | "forgot";

const TITLE: Record<Mode, string> = { signin: "Sign in", register: "Create an account", forgot: "Reset your password" };

export function AccountDialog({
  open,
  onClose,
  onSignedIn,
  initialMode = "signin",
  pendingPreferences,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: (account: Account, preferences: Preferences, created: boolean) => void;
  initialMode?: Mode;
  /** Preferences set before signing up; saved with the new account. */
  pendingPreferences: Preferences;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        const { message } = await post<{ message: string }>("/api/account/forgot", { email });
        setNotice(message);
        return;
      }
      const body = mode === "register" ? { email, password, preferences: pendingPreferences } : { email, password };
      const res = await post<{ user: Account; preferences: Preferences }>(`/api/account/${mode === "register" ? "register" : "login"}`, body);
      setPassword("");
      onSignedIn(res.user, res.preferences, mode === "register");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={TITLE[mode]} width={440}>
      <form onSubmit={submit} className="space-y-4 p-5">
        {mode === "register" && (
          <p className="text-[13px] leading-relaxed text-mute">
            An account saves your travel preferences (home airports, alliances, airlines to prefer or avoid) and applies them to every search, on any device.
          </p>
        )}
        <Field label="Email">
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        {mode !== "forgot" && (
          <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}>
            <input
              type="password"
              required
              minLength={mode === "register" ? 8 : 1}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {notice && <p className="text-[13px] text-body">{notice}</p>}
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : mode === "register" ? "Create account" : "Email me a reset link"}
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-[13px]">
          {mode === "signin" ? (
            <>
              <button type="button" className="cursor-pointer text-accent hover:underline pointer-coarse:min-h-11" onClick={() => switchTo("register")}>
                Create an account
              </button>
              <button type="button" className="cursor-pointer text-mute hover:text-ink pointer-coarse:min-h-11" onClick={() => switchTo("forgot")}>
                Forgot password?
              </button>
            </>
          ) : (
            <button type="button" className="cursor-pointer text-accent hover:underline" onClick={() => switchTo("signin")}>
              {mode === "register" ? "Have an account? Sign in" : "Back to sign in"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
