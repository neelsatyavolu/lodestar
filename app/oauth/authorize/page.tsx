import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui";
import { getDb, type Db } from "@/lib/db/client";
import { getUser } from "@/lib/db/users";
import { checkAuthorize, PARAM_KEYS, single, type AuthorizeParams } from "@/lib/oauth/authorize";
import { currentUserId } from "@/lib/server/auth";
import { env } from "@/lib/server/env";

// The consent screen an agent sends the traveller to when it connects to
// Lodestar Trips over MCP. Signed out: a link to sign in that comes back here.

export const metadata: Metadata = { title: "Connect an app — Lodestar", robots: { index: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-24 pb-24">
      <p className="text-[13px] text-mute">Lodestar</p>
      <h1 className="mt-2 font-display text-[clamp(32px,6vw,44px)] leading-tight tracking-[-0.02em]">{title}</h1>
      {children}
    </main>
  );
}

const list = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/** The request as of now: checked once per visit, outside rendering. */
async function check(db: Db, params: AuthorizeParams & { repeated: boolean }) {
  return checkAuthorize(db, params, env().APP_URL, Date.now());
}

async function Consent({ searchParams }: { searchParams: Search }) {
  const raw = await searchParams;
  const params = single((k) => list(raw[k]), PARAM_KEYS);
  const db = await getDb();
  const checked = await check(db, params);
  if (checked.kind === "redirect") redirect(checked.url);
  if (checked.kind === "show")
    return (
      <Shell title="This app can't connect">
        <p className="mt-4 text-[15px] leading-relaxed text-body">{checked.message}</p>
      </Shell>
    );

  const { client, redirectUri } = checked.request;
  const userId = await currentUserId();
  const user = userId ? await getUser(db, userId) : null;
  const here = `/oauth/authorize?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")).toString()}`;
  const returnsTo = new URL(redirectUri);
  const returnsLabel = returnsTo.protocol === "https:" || returnsTo.protocol === "http:" ? returnsTo.host : `${returnsTo.protocol}//`;

  if (!user)
    return (
      <Shell title={`Connect ${client.name}`}>
        <p className="mt-4 text-[15px] leading-relaxed text-body">Sign in to Lodestar to let {client.name} work on your trips.</p>
        <a href={`/?signin=1&next=${encodeURIComponent(here)}`} className="mt-8 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-on hover:bg-primary-hover">
          Sign in to Lodestar
        </a>
      </Shell>
    );

  return (
    <Shell title={`Connect ${client.name}`}>
      <p className="mt-4 text-[15px] leading-relaxed text-body">
        <span className="text-ink">{client.name}</span> wants to plan with your Lodestar trips.
      </p>
      <ul className="mt-6 space-y-3 border-y border-hairline py-5 text-[14px] text-body">
        <li>See your trips: itineraries, bookings and confirmation numbers, checklists, notes and budgets.</li>
        <li>Add, change and delete things in them, and start new trips.</li>
        <li>It can&apos;t see your password, your email or your AI connections.</li>
      </ul>
      <p className="mt-5 text-[13px] text-mute">
        Signed in as {user.email}. You&apos;ll go back to <span className="font-mono text-charcoal">{returnsLabel}</span>. Disconnect it any time under Agents.
      </p>
      <form method="post" action="/api/oauth/authorize" className="mt-8 flex gap-2">
        {Object.entries(params).map(([k, v]) => (typeof v === "string" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <Button type="submit" name="decision" value="allow" variant="primary">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" variant="quiet">
          Cancel
        </Button>
      </form>
    </Shell>
  );
}

export default function AuthorizePage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}
