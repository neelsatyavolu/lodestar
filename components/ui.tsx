import type { ButtonHTMLAttributes, ReactNode } from "react";

// Primitives from ~/DESIGN.md (Ink & Instrument v3): primary is ink on canvas
// (inverted in light mode), accent is the one blue action, ghost and outline are
// secondary. 36px tall (44px on touch), 4px radius; pills are full radius.

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "accent" | "ghost" | "outline" | "quiet"; size?: "md" | "sm" };

export function Button({ variant = "ghost", size = "md", className = "", ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:text-stone disabled:cursor-default cursor-pointer whitespace-nowrap";
  const sizes = size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm max-sm:h-11";
  const variants = {
    primary: "bg-primary text-primary-on hover:bg-primary-hover disabled:bg-hover disabled:text-stone",
    accent: "bg-accent text-accent-on hover:bg-accent-hover disabled:bg-hover disabled:text-stone",
    ghost: "bg-transparent text-ink border border-hairline-strong hover:bg-hover",
    outline: "bg-canvas text-ink border border-hairline-strong hover:bg-elevated",
    quiet: "text-charcoal hover:text-ink",
  }[variant];
  return <button className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

export type State = "ok" | "warn" | "danger";
const DOT: Record<State, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" };

/** An 8px state dot. Green, yellow and red appear only here, always beside a label. */
export function StatusDot({ state, className = "" }: { state: State; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[state]} ${className}`} aria-hidden />;
}

/** A pill. "accent" is the spec's badge (blue tint, blue text); a dot marks a state. */
export function Pill({ children, tone = "neutral", dot, className = "" }: { children: ReactNode; tone?: "neutral" | "accent"; dot?: State; className?: string }) {
  const look = tone === "accent" ? "bg-tint text-accent" : "bg-elevated text-body";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${look} ${className}`}>
      {dot && <StatusDot state={dot} className="!size-1.5" />}
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={hint}
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] cursor-pointer max-sm:h-10 ${
        checked ? "border-hairline-hover bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"
      }`}
    >
      <span className={`relative h-3.5 w-6 rounded-full ${checked ? "bg-accent" : "bg-stone"}`}>
        <span className={`absolute top-0.5 size-2.5 rounded-full bg-canvas transition-[left] duration-150 ${checked ? "left-3" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-hairline-strong bg-card ${className}`}>{children}</div>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-hairline-strong border-t-ink ${className}`} aria-hidden />;
}
