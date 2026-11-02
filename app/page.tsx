import { connection } from "next/server";
import { Suspense } from "react";
import { App } from "@/components/app";

// The app's default search uses today's date, so it must render per request:
// a prerendered copy would carry the build day's dates and fail to hydrate later.
async function PerRequestApp() {
  await connection();
  return <App />;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <PerRequestApp />
    </Suspense>
  );
}
