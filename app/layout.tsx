import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { GeistSerif } from "geist/font/serif";
import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "Lodestar — lower fares from sellers you can trust";
const DESCRIPTION = "Live flight prices, travel hacks that actually save money, and an AI that compares the options for you. Only airlines and trusted agencies by default.";

export const metadata: Metadata = {
  // Link previews need absolute image URLs; APP_URL is the public site address.
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "Lodestar", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
  ],
};

// Applies a saved theme choice before first paint so the page never flashes the wrong one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerif.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
