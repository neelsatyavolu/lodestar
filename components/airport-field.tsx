import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client";

type Suggestion = { code: string; label: string; detail: string; metro: boolean };

const MAX_CODES = 4;

export function AirportField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (codes: string[]) => void; placeholder: string }) {
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
      api<Suggestion[]>(`/api/airports?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((s) => {
          setFetched({ q, items: s });
          setActive(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text]);

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
    } else if (e.key === "Enter" && /^[a-z]{3}$/i.test(text.trim())) {
      e.preventDefault();
      add(text.trim().toUpperCase());
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label className="block px-3 pt-2.5 text-[11px] text-ash">{label}</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 px-3 pb-2" onClick={() => input.current?.focus()}>
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
          className="min-w-20 flex-1 bg-transparent py-1 text-[15px] text-ink placeholder:text-stone outline-none"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
        />
      </div>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-lg border border-hairline-strong bg-elevated p-1 sm:min-w-80">
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
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${i === active ? "bg-[rgba(255,255,255,0.06)]" : ""}`}
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
