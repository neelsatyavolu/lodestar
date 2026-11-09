import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client";

type Suggestion = { code: string; label: string; detail: string };
type Kind = "airport" | "airline";

const SOURCES: Record<Kind, { url: (q: string) => string; codeLength: number; toSuggestions: (data: unknown) => Suggestion[] }> = {
  airport: { url: (q) => `/api/airports?q=${encodeURIComponent(q)}`, codeLength: 3, toSuggestions: (d) => d as Suggestion[] },
  airline: {
    url: (q) => `/api/airlines?q=${encodeURIComponent(q)}`,
    codeLength: 2,
    toSuggestions: (d) => (d as { code: string; name: string }[]).map((a) => ({ code: a.code, label: a.name, detail: a.code })),
  },
};

/** Chips for several codes, with type-ahead suggestions. Airports by default; airlines with kind="airline". */
export function AirportField({
  label,
  value,
  onChange,
  placeholder,
  kind = "airport",
  max = 4,
  bare = false,
}: {
  label: string;
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder: string;
  kind?: Kind;
  max?: number;
  /** Without the form-cell padding, for use inside other layouts. */
  bare?: boolean;
}) {
  const MAX_CODES = max;
  const source = SOURCES[kind];
  const [text, setText] = useState("");
  const [fetched, setFetched] = useState<{ q: string; items: Suggestion[] }>({ q: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const q = text.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<unknown>(source.url(q), { signal: ctrl.signal })
        .then((data) => {
          setFetched({ q, items: source.toSuggestions(data) });
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, source]);

  // Only show suggestions for what is typed now; stale ones vanish as soon as the text changes.
  const items = text.trim() && fetched.q === text.trim() ? fetched.items : [];

  const add = (code: string) => {
    if (!value.includes(code) && value.length < MAX_CODES) onChange([...value, code]);
    setText("");
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && items[active]) {
      e.preventDefault();
      add(items[active].code);
    } else if (e.key === "Enter" && text.trim().length === source.codeLength && /^[a-z0-9]+$/i.test(text.trim())) {
      e.preventDefault();
      add(text.trim().toUpperCase());
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label className={`block text-[12px] text-ash ${bare ? "pb-1.5" : "px-3 pt-2.5"}`}>{label}</label>
      <div
        className={`flex min-h-10 flex-wrap items-center gap-1.5 ${bare ? "rounded-md border border-hairline-hover bg-card px-2 py-1 has-[input:focus]:border-accent" : "px-3 pb-2"}`}
        onClick={() => input.current?.focus()}
      >
        {value.map((code) => (
          <span key={code} className="inline-flex items-center gap-1 rounded-sm bg-elevated py-0.5 pl-2 pr-1 font-mono text-[13px] text-ink">
            {code}
            <button type="button" aria-label={`Remove ${code}`} className="rounded-sm p-0.5 text-ash hover:text-ink cursor-pointer" onClick={() => onChange(value.filter((c) => c !== code))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          placeholder={value.length ? (value.length < MAX_CODES ? "Add airport" : "") : placeholder}
          disabled={value.length >= MAX_CODES}
          className={`min-w-20 flex-1 bg-transparent py-1 text-[15px] text-ink placeholder:text-mute outline-none ${bare ? "focus-visible:outline-none!" : ""}`}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
        />
      </div>
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          // Inside a dialog the list sits in the flow, so the dialog's scroll area can't clip it.
          ref={bare ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
          className={`overflow-auto rounded-lg border border-hairline-strong bg-elevated p-1 ${bare ? "mt-1 max-h-56" : "absolute left-0 right-0 top-full z-30 mt-1 max-h-80 sm:min-w-80"}`}
        >
          {items.map((s, i) => (
            <li
              key={s.code}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.code);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${i === active ? "bg-hover" : ""}`}
            >
              <span className="w-10 shrink-0 font-mono text-[13px] text-ink">{s.code}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{s.label}</span>
                <span className="block truncate text-xs text-ash">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
