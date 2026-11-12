import { Button } from "./ui";

// Xanom sign-in (accounts.xanom.co): the "Continue with Xanom" button and the account row in
// preferences. Each one is a full-page trip through /api/xanom/start and back.

type Intent = "signin" | "link" | "convert";

export function xanomStart(intent: Intent, returnTo: string | null): void {
  const q = new URLSearchParams({ intent, return: returnTo ?? "/" });
  window.location.assign(new URL(`/api/xanom/start?${q}`, window.location.origin));
}

export function ContinueWithXanom({ returnTo }: { returnTo: () => string | null }) {
  return (
    <Button type="button" variant="primary" className="w-full" onClick={() => xanomStart("signin", returnTo())}>
      Continue with Xanom
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-ash" aria-hidden>
      <span className="h-px flex-1 bg-hairline" />
      or with email
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

const linkClass = "cursor-pointer text-accent hover:underline pointer-coarse:min-h-11";

/** Signed-in only. Linked: which Xanom account. Not linked: convert in one click, or link another. */
export function XanomAccountRow({ xanomEmail }: { xanomEmail: string | null }) {
  if (xanomEmail) {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-charcoal">
        <span>
          Signed in with Xanom · <span className="font-mono text-ink">{xanomEmail}</span>
        </span>
        <a href="https://accounts.xanom.co" target="_blank" rel="noreferrer" className={linkClass}>
          Manage at accounts.xanom.co
        </a>
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-relaxed text-mute">One Xanom account signs you in to Lodestar and the other Xanom apps. Your email and password keep working.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="outline" size="sm" onClick={() => xanomStart("convert", "/")}>
          Convert to Xanom account
        </Button>
        <button type="button" className={`text-[13px] ${linkClass}`} onClick={() => xanomStart("link", "/")}>
          Link an existing Xanom account
        </button>
      </div>
    </div>
  );
}
