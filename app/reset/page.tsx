import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/reset-form";

export const metadata: Metadata = { title: "Reset password — Lodestar", robots: { index: false } };

export default function ResetPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-24 pb-24">
      <h1 className="font-display text-[44px] tracking-[-0.02em]">Choose a new password</h1>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
