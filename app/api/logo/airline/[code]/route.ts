import { airlineSources, imageResponse, logo, monogram } from "@/lib/logos";

// GET /api/logo/airline/AA — airline logo, never a broken image.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (!/^[A-Z0-9]{2,3}$/.test(code)) return imageResponse(monogram("?"));
  return imageResponse(await logo(`airline:${code}`, airlineSources(code), code));
}
