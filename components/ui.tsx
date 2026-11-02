import type { ButtonHTMLAttributes, ReactNode } from "react";

// Primitives from the design spec: white primary (the brightest pixel), ghost
// and outline buttons at 36px / 8px radius, pills at full radius.

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "quiet"; size?: "md" | "sm" };

export function Button({ variant = "ghost", size = "md", className = "", ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-ui font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap";
  const sizes = size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm max-sm:h-11";
  const variants = {
    primary: "bg-ink text-black hover:bg-light active:bg-light",
    ghost: "bg-elevated text-ink border border-hairline-strong hover:border-[rgba(255,255,255,0.28)]",
    outline: "bg-canvas text-ink border border-hairline-strong hover:bg-elevated",
    quiet: "text-charcoal hover:text-ink",
  }[variant];
  return <button className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "green" | "yellow" | "red" | "blue"; className?: string }) {
  const dot = { neutral: null, green: "bg-green", yellow: "bg-yellow", red: "bg-red", blue: "bg-blue" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 text-xs text-body ${className}`}>
      {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
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
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors cursor-pointer max-sm:h-10 ${
        checked ? "border-[rgba(255,255,255,0.32)] bg-elevated text-ink" : "border-hairline-strong text-mute hover:text-charcoal"
      }`}
    >
      <span className={`relative h-3.5 w-6 rounded-full transition-colors ${checked ? "bg-ink" : "bg-stone"}`}>
        <span className={`absolute top-0.5 size-2.5 rounded-full bg-black transition-all ${checked ? "left-3" : "left-0.5"}`} />
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
