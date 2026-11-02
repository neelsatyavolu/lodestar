import { imageResponse, logo, monogram, siteSources } from "@/lib/logos";
import { isValidDomain } from "@/lib/sellers";

// GET /api/logo/site/expedia.com?name=Expedia — a seller's icon. Only Google's
// and DuckDuckGo's icon services are contacted, never the domain itself.
// Use "_" as the domain to get a monogram for `name`.
export async function GET(req: Request, { params }: { params: Promise<{ domain: string }> }) {
  let domain: string;
  try {
    domain = decodeURIComponent((await params).domain).toLowerCase();
  } catch {
    domain = "_";
  }
  const name = (new URL(req.url).searchParams.get("name") ?? domain).slice(0, 60);
  if (domain === "_" || !isValidDomain(domain)) return imageResponse(monogram(name));
  return imageResponse(await logo(`site:${domain}`, siteSources(domain), name));
}
