import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The link preview (iMessage, Slack, social). Built at deploy time in the
// Blackletter look: black canvas, Geist Serif headline, one blue accent.

export const alt = "Lodestar: lower fares from sellers you can trust";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#fcfdff";
const MUTE = "#a1a4a5";
const ACCENT = "#4C8DFF";

export default async function Image() {
  const [serif, sans] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/GeistSerif-Regular.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Geist-Regular.ttf")),
  ]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000", padding: "72px 80px", fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, color: INK, fontSize: 36 }}>
          <svg width="40" height="40" viewBox="0 0 22 22">
            <path d="M11 1.5 L12.6 9.4 L20.5 11 L12.6 12.6 L11 20.5 L9.4 12.6 L1.5 11 L9.4 9.4 Z" fill={INK} />
          </svg>
          Lodestar
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 72, fontFamily: "Geist Serif", fontSize: 96, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          <span style={{ color: INK }}>Lower fares.</span>
          <span style={{ color: MUTE }}>Sellers you can trust.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: "auto", fontSize: 28, color: MUTE }}>
          <span style={{ width: 48, height: 4, background: ACCENT }} />
          Live Google Flights fares, travel hacks, and an AI that plans the trip
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist Serif", data: serif, style: "normal", weight: 400 },
        { name: "Geist", data: sans, style: "normal", weight: 400 },
      ],
    },
  );
}
