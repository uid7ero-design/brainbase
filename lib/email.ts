import 'server-only';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const FROM = process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>';

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev fallback — print to console
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    console.log('\n── EMAIL (no RESEND_API_KEY) ─────────────────────');
    console.log(`TO:      ${to}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(text.slice(0, 600));
    console.log('──────────────────────────────────────────────────\n');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[email] Resend ${res.status}:`, err);
    throw new Error('Email send failed');
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export function verificationEmail(name: string, token: string) {
  const link = `${BASE_URL}/api/auth/verify-email?token=${token}`;
  return {
    subject: 'Verify your Brainbase email',
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(name)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        Your Brainbase account has been created. Click the button below to verify
        your email address and activate your account.
      </p>
      <a href="${link}" style="${btnStyle}">Verify email address</a>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        This link expires in 24 hours. If you didn't expect this email, ignore it.
      </p>
    `),
  };
}

export function passwordResetEmail(name: string, token: string) {
  const link = `${BASE_URL}/reset-password?token=${token}`;
  return {
    subject: 'Reset your Brainbase password',
    html: emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">Hi ${escHtml(name)},</h2>
      <p style="margin:0 0 24px;color:#444;line-height:1.6">
        We received a request to reset your password. Click below to choose a new one.
      </p>
      <a href="${link}" style="${btnStyle}">Reset password</a>
      <p style="margin:28px 0 0;font-size:12px;color:#888;line-height:1.5">
        This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.
      </p>
    `),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const btnStyle = [
  'display:inline-block',
  'padding:12px 28px',
  'background:#7C3AED',
  'color:#fff',
  'text-decoration:none',
  'border-radius:8px',
  'font-size:14px',
  'font-weight:600',
  'letter-spacing:0.02em',
].join(';');

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emailLayout(body: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="padding:24px 32px;background:#08090C;border-bottom:1px solid #1c1c2e">
          <span style="font-size:18px;font-weight:700;letter-spacing:.1em;color:#f4f4f5">
            BRAINB<span style="color:#A78BFA">Λ</span>SE
          </span>
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
