import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BASE_URL } from '@/lib/email';

// Phase C4.3B — shared Commercial document-email shell, extracted
// verbatim (no behavior change) from lib/commercial/quoteEmail.ts so
// lib/commercial/invoiceEmail.ts can reuse the exact same canonical
// Hybrid Orbit branding rather than duplicating it. This is a pure
// move: every function body below is byte-identical to its prior
// location in quoteEmail.ts. See quotePdf.ts's own header for the full
// rationale behind the image-based (never font-glyph) wordmark
// treatment — that reasoning applies identically here and is not
// repeated.
//
// Deliberately still scoped to Commercial only (quotes + invoices),
// NOT merged into lib/email.ts's shared emailLayout() — that function
// renders "BRAINBΛSE" as literal HTML text with a Unicode Greek lambda
// character, which is fine for its many unrelated callers (auth,
// password reset, admin invites, events ticket email) but not the real
// canonical Hybrid Orbit identity this phase's PDF/email surfaces use.
// Widening emailLayout() itself for every one of those unrelated
// surfaces remains explicitly out of scope here, exactly as it was
// when this shell was first written for quotes alone.

let cachedBrandLockupBase64: string | null = null;

// Server-side loader for the rasterized Hybrid Orbit icon+wordmark
// lockup PNG. Reads from disk once per server instance and memoizes;
// the file is a small, static, committed repository asset, never
// user-controlled input.
export async function loadBrandLockupBase64Server(): Promise<string> {
  if (cachedBrandLockupBase64) return cachedBrandLockupBase64;
  const filePath = path.join(process.cwd(), 'public', 'Brand', 'brainbase-horizontal-color-284.png');
  const buf = await fs.readFile(filePath);
  cachedBrandLockupBase64 = buf.toString('base64');
  return cachedBrandLockupBase64;
}

// Uses an absolute same-origin URL (BASE_URL), not a third-party image
// host and not an inline base64 data: URI — a linked image is the
// standard, most broadly email-client-compatible way to reference a
// logo in transactional email, and this asset is already confirmed
// publicly reachable at this exact path.
export function commercialEmailLayout(body: string): string {
  const logoUrl = `${BASE_URL}/Brand/brainbase-horizontal-color-284.png`;
  // 1600x284 source raster — width chosen for a typical email header,
  // height computed to preserve that exact aspect ratio (never a fixed
  // guess that could distort the lockup).
  const logoWidth = 180;
  const logoHeight = Math.round((logoWidth * 284) / 1600);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="padding:24px 32px;background:#08090C;border-bottom:1px solid #1c1c2e">
          <img src="${logoUrl}" alt="BrainBase" width="${logoWidth}" height="${logoHeight}" style="display:block;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:36px 32px">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#aaa">
          © ${new Date().getFullYear()} Brainbase · Adelaide SA Australia
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function emailDetailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:7px 0;color:#888;width:120px;vertical-align:top;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${label}</td>
      <td style="padding:7px 0 7px 16px;color:#222;border-bottom:1px solid #f0f0f0">${value}</td>
    </tr>
  `;
}

// audit_logs never stores the full recipient address. Shared here
// (rather than re-duplicated per document type) because quotes and
// invoices are the same vertical, unlike the Events/Commercial split
// this same helper's own prior duplication (from
// lib/events/ticketEmail.ts) deliberately preserved.
export function maskEmailForAudit(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
