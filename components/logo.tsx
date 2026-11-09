import { useState } from "react";

// The logo routes already fall back to a monogram server-side. This covers the
// last case (the route itself unreachable) so no logo ever shows as broken.

export function Logo({ src, name, size = 28, className = "" }: { src: string; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (failed) {
    return (
      <span style={style} className={`inline-flex shrink-0 items-center justify-center rounded-md border border-hairline-strong bg-elevated text-[10px] font-medium text-ink ${className}`} aria-label={name}>
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny proxied logos; next/image adds nothing here
    <img
      src={src}
      alt={name}
      title={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style}
      className={`shrink-0 rounded-md bg-white object-contain p-1 ${className}`}
    />
  );
}

export function AirlineLogo({ code, name, size = 28 }: { code: string; name: string; size?: number }) {
  return <Logo src={`/api/logo/airline/${encodeURIComponent(code)}`} name={name} size={size} />;
}
