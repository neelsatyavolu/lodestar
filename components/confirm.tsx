"use client";

import { useSyncExternalStore } from "react";
import { Dialog } from "./dialog";
import { Button } from "./ui";

// "Are you sure?" as a page dialog rather than window.confirm: a native
// prompt blocks browser agents and can't be seen or clicked by some of them,
// while this one is ordinary buttons with plain names. Mount <ConfirmHost />
// once; call askConfirm anywhere.

type Ask = { title: string; body?: string; action: string; resolve: (yes: boolean) => void };

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Resolves true when the traveller presses `action`, false when they cancel or close. */
export function askConfirm(title: string, action: string, body?: string): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { title, body, action, resolve };
    emit();
  });
}

function answer(yes: boolean) {
  const ask = current;
  current = null;
  emit();
  ask?.resolve(yes);
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function ConfirmHost() {
  const ask = useSyncExternalStore(subscribe, () => current, () => null);
  return (
    <Dialog
      open={ask !== null}
      onClose={() => answer(false)}
      title={ask?.title ?? ""}
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => answer(true)} autoFocus>
            {ask?.action}
          </Button>
        </div>
      }
    >
      {ask?.body ? <p className="px-5 py-4 text-[14px] text-body">{ask.body}</p> : <span />}
    </Dialog>
  );
}
