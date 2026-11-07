import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SharedTripView } from "@/components/share/shared-trip";
import { getDb } from "@/lib/db/client";
import { sharedJourney } from "@/lib/db/journeys";
import { publicTrip } from "@/lib/journeys/share";

// A trip's read-only share link. Looked up on every request, never cached, so
// turning sharing off closes the link at once. No referrer leaves the page, so
// the link's secret never reaches the sites it links to.

export const metadata: Metadata = { title: "Shared trip — Lodestar", robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN = /^[\w-]{32}$/;

async function Shared({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const trip = TOKEN.test(token) ? await sharedJourney(await getDb(), token) : null;
  if (!trip) notFound();
  return <SharedTripView trip={publicTrip(trip)} today={new Date().toISOString().slice(0, 10)} />;
}

export default function SharedTripPage({ params }: PageProps<"/t/[token]">) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Shared params={params} />
    </Suspense>
  );
}
