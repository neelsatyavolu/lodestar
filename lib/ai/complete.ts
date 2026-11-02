import "server-only";
import type { Provider, Tokens } from "./providers";

// One model call on the traveller's own ChatGPT or Grok subscription, using the
// Responses API both providers speak. Streams upstream (the ChatGPT backend
// requires it) and returns the full text.

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const GROK_RESPONSES_URL = "https://api.x.ai/v1/responses";
const IDLE_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 45_000;

export type CompleteParams = {
  provider: Provider;
  tokens: Tokens;
  model: string;
  system: string;
  user: string;
  effort: "low" | "medium" | "high";
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
};

export class ModelError extends Error {}

export function upstreamError(status: number, text: string): string {
  try {
    const json = JSON.parse(text);
    const message = json?.error?.message ?? json?.detail ?? json?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return "Your AI connection expired. Reconnect it.";
  if (status === 429) return "Your subscription's rate limit was hit. Try again in a moment.";
  return `The model request failed (HTTP ${status}).`;
}

function request(p: CompleteParams, withEffort: boolean): [string, RequestInit] {
  const auth = { Authorization: `Bearer ${p.tokens.accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream" };
  if (p.provider === "codex") {
    const headers: Record<string, string> = { ...auth, originator: "codex_cli_rs", "OpenAI-Beta": "responses=v1" };
    if (p.tokens.accountId) headers["chatgpt-account-id"] = p.tokens.accountId;
    const body = {
      model: p.model,
      instructions: p.system,
      input: [{ role: "user", content: [{ type: "input_text", text: p.user }] }],
      ...(withEffort ? { reasoning: { effort: p.effort } } : {}),
      store: false,
      stream: true,
    };
    return [CODEX_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) }];
  }
  const body = {
    model: p.model,
    input: [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    temperature: 0.2,
    ...(withEffort && /^grok-4/.test(p.model) ? { reasoning: { effort: p.effort } } : {}),
    store: false,
    stream: true,
  };
  return [GROK_RESPONSES_URL, { method: "POST", headers: { ...auth, "User-Agent": "grok-cli/1.0" }, body: JSON.stringify(body) }];
}

type Event = { delta?: string; done?: boolean; error?: string; text?: string };

/** Interpret one SSE `data:` payload from the Responses API. */
export function parseEvent(data: string): Event | null {
  if (data === "[DONE]") return { done: true };
  let json: { type?: string; delta?: unknown; error?: { message?: string }; message?: string; response?: { error?: { message?: string }; output?: unknown[] } };
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  switch (json.type) {
    case "response.output_text.delta":
      return typeof json.delta === "string" ? { delta: json.delta } : null;
    case "response.completed":
      return { done: true };
    case "response.failed":
      return { error: json.response?.error?.message ?? "The model failed to answer." };
    case "error":
      return { error: json.error?.message ?? json.message ?? "The model returned an error." };
    default:
      return null;
  }
}

/** Split an SSE byte stream into `data:` payloads. */
export function sseLines(onData: (data: string) => void) {
  let buffer = "";
  let dataLines: string[] = [];
  const line = (raw: string) => {
    const l = raw.replace(/\r$/, "");
    if (l === "") {
      if (dataLines.length) onData(dataLines.join("\n"));
      dataLines = [];
    } else if (l.startsWith("data:")) dataLines.push(l.slice(5).trimStart());
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush() {
      if (buffer) line(buffer);
      line("");
      buffer = "";
    },
  };
}

async function open(p: CompleteParams): Promise<ReadableStream<Uint8Array>> {
  let withEffort = true;
  for (let tries = 0; tries < 2; tries++) {
    const [url, init] = request(p, withEffort);
    const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
    const res = await fetch(url, { ...init, signal: p.signal ? AbortSignal.any([p.signal, timeout]) : timeout }).catch((err) => {
      if (timeout.aborted) throw new ModelError("The model did not respond. Try again.");
      throw err;
    });
    if (res.ok && res.body) return res.body;
    const text = await res.text().catch(() => "");
    if (res.status === 400 && withEffort && /effort|reasoning/i.test(text)) {
      withEffort = false;
      continue;
    }
    throw new ModelError(upstreamError(res.status, text));
  }
  throw new ModelError("The model request failed.");
}

export async function complete(p: CompleteParams): Promise<string> {
  const body = await open(p);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let error: string | null = null;
  let done = false;
  const parser = sseLines((data) => {
    const ev = parseEvent(data);
    if (!ev || done) return;
    if (ev.delta) {
      text += ev.delta;
      p.onDelta?.(ev.delta);
    }
    if (ev.error) error = ev.error;
    if (ev.done || ev.error) done = true;
  });
  let idle: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      stalled = true;
      reader.cancel().catch(() => {});
    }, IDLE_TIMEOUT_MS);
  };
  try {
    for (;;) {
      arm();
      const { value, done: end } = await reader.read();
      if (end) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (done) {
        reader.cancel().catch(() => {});
        break;
      }
    }
    parser.flush();
  } finally {
    clearTimeout(idle);
  }
  if (error) throw new ModelError(error);
  if (stalled && !done) throw new ModelError("The model stopped responding. Try again.");
  if (!text) throw new ModelError("The model stopped before answering. Try again.");
  return text;
}
