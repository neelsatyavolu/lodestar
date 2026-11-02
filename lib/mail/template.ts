/**
 * The one transactional email layout. Mail clients ignore stylesheets and web
 * fonts, so everything is inline, laid out with tables, in Lodestar's black
 * canvas and white primary button.
 */

export type EmailCopy = { subject: string; heading: string; body: string; button: string; url: string; linkHint: string; footer: string };
export type RenderedEmail = { subject: string; html: string; text: string };

const BG = "#000000";
const CARD = "#0a0a0c";
const INK = "#fcfdff";
const INK_2 = "#a1a4a5";
const LINE = "#2a2a2e";
const BUTTON = "#fcfdff";
const BUTTON_TEXT = "#000000";
const SANS = "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function renderEmail(copy: EmailCopy): RenderedEmail {
  const url = escapeHtml(copy.url);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;text-align:left;">
<tr><td style="padding:0 4px 20px;font-family:${SERIF};font-size:22px;line-height:28px;color:${INK};">&#10022; Lodestar</td></tr>
<tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:28px;">
<div style="font-family:${SANS};font-size:22px;line-height:30px;font-weight:500;color:${INK};">${escapeHtml(copy.heading)}</div>
<div style="padding-top:12px;font-family:${SANS};font-size:16px;line-height:26px;color:${INK};">${escapeHtml(copy.body)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td bgcolor="${BUTTON}" style="background:${BUTTON};border-radius:8px;"><a href="${url}" style="display:inline-block;padding:11px 18px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:500;color:${BUTTON_TEXT};text-decoration:none;">${escapeHtml(copy.button)}</a></td></tr></table>
<div style="padding-top:24px;font-family:${SANS};font-size:13px;line-height:20px;color:${INK_2};">${escapeHtml(copy.linkHint)}</div>
<div style="padding-top:4px;font-family:${SANS};font-size:12px;line-height:18px;word-break:break-all;"><a href="${url}" style="color:${INK_2};">${url}</a></div>
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${INK_2};">${escapeHtml(copy.footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = ["LODESTAR", copy.heading, copy.body, `${copy.button}: ${copy.url}`, copy.footer].join("\n\n");
  return { subject: copy.subject, html, text };
}
