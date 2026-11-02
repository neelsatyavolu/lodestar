// Builds data/airports.json from OurAirports (public domain) for autocomplete
// and nearby-airport search. Keeps airports with scheduled service and an IATA
// code that the fares service can search (data/fli-airports.txt, one code per
// line, exported from fli's Airport enum).
//
//   node scripts/build-airports.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const SIZE = { large_airport: 3, medium_airport: 2, small_airport: 1 };

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const searchable = new Set(readFileSync(new URL("../data/fli-airports.txt", import.meta.url), "utf8").split(/\s+/).filter(Boolean));
const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`OurAirports download failed: HTTP ${res.status}`);
const [header, ...rows] = parseCsv(await res.text());
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const airports = rows
  .filter((r) => r[col.scheduled_service] === "yes" && /^[A-Z]{3}$/.test(r[col.iata_code] ?? "") && SIZE[r[col.type]])
  .filter((r) => searchable.has(r[col.iata_code]))
  .map((r) => ({
    code: r[col.iata_code],
    name: r[col.name],
    city: r[col.municipality] || r[col.name],
    country: r[col.iso_country],
    lat: Math.round(Number(r[col.latitude_deg]) * 1e4) / 1e4,
    lon: Math.round(Number(r[col.longitude_deg]) * 1e4) / 1e4,
    size: SIZE[r[col.type]],
  }))
  .sort((a, b) => b.size - a.size || a.code.localeCompare(b.code));

writeFileSync(new URL("../data/airports.json", import.meta.url), JSON.stringify(airports));
console.log(`wrote ${airports.length} airports`);
