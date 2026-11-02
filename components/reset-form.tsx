"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { post } from "@/lib/client";
import { Field, inputClass } from "./dialog";
import { Button } from "./ui";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="mt-6 text-[15px] text-body">
        Your password is changed and you&apos;re signed in. Every other session was signed out.{" "}
        <Link href="/" className="text-accent hover:underline">
          Back to Lodestar
        </Link>
      </p>
    );
  }

  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await post("/api/account/reset", { token, password });
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "That didn't work. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!token && <p className="text-[13px] text-danger">This link is missing its code. Open the link from the email again.</p>}
      <Field label="New password" hint="At least 8 characters.">
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </Field>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !token} className="w-full">
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
