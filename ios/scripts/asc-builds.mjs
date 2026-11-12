#!/usr/bin/env node
// Lists Lodestar's latest App Store Connect builds and their processing state.
//   node ios/scripts/asc-builds.mjs [limit]
// Uses the API key in ~/.appstoreconnect/private_keys (override with ASC_KEY_ID / ASC_ISSUER_ID).
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const KEY_ID = process.env.ASC_KEY_ID ?? "U27MTWCKH5";
const ISSUER = process.env.ASC_ISSUER_ID ?? "ec1e9e67-6c4b-44da-9ef7-39a0d5925d2d";
const APP_ID = process.env.ASC_APP_ID ?? "6832135815"; // "Lodestar Flights", co.xanom.lodestar
const limit = Number(process.argv[2] ?? 5);

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" });
const body = b64({ iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
const key = createPrivateKey(readFileSync(`${homedir()}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`));
const jwt = `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;

const url = new URL("https://api.appstoreconnect.apple.com/v1/builds");
url.searchParams.set("filter[app]", APP_ID);
url.searchParams.set("sort", "-uploadedDate");
url.searchParams.set("limit", String(limit));
url.searchParams.set("include", "preReleaseVersion");
const res = await fetch(url, { headers: { authorization: `Bearer ${jwt}` } });
if (!res.ok) {
  console.error(`App Store Connect answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const json = await res.json();
const versions = new Map((json.included ?? []).map((v) => [v.id, v.attributes.version]));
for (const b of json.data) {
  const version = versions.get(b.relationships?.preReleaseVersion?.data?.id) ?? "?";
  console.log(`${version} (${b.attributes.version})  ${b.attributes.processingState}  uploaded ${b.attributes.uploadedDate}`);
}
