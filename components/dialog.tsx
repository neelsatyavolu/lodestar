import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A native modal dialog in the card style. The header and the optional footer
 * stay put; only the body scrolls, so actions are always on screen however
 * tall the content or short the window. Escape and the close button call onClose.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      className="m-auto overflow-hidden rounded-xl border border-hairline-strong bg-card p-0 text-ink backdrop:bg-scrim"
    >
      <div className="flex max-h-[calc(100dvh-32px)] flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="text-base font-medium">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 inline-flex size-8 cursor-pointer items-center justify-center text-ash hover:text-ink pointer-coarse:-mr-3 pointer-coarse:size-11">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{open && children}</div>
        {open && footer && <div className="shrink-0 border-t border-hairline bg-card px-5 py-4">{footer}</div>}
      </div>
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] text-charcoal">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ash">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-hairline-hover bg-card px-3 text-[14px] text-ink outline-none placeholder:text-mute focus:border-accent max-sm:h-12";
