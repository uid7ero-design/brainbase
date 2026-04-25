import fs   from 'fs';
import path from 'path';

const TOKEN_FILE  = path.join(process.cwd(), '.brainbase', 'gmail_tokens.json');
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';

export type GmailTokens = {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;
  email?:        string;
};

export function readTokens(): GmailTokens | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function writeTokens(tokens: GmailTokens) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
}

export function clearTokens() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {}
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;

  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  writeTokens({
    access_token:  data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at:    Date.now() + (data.expires_in ?? 3600) * 1000,
    email:         tokens.email,
  });

  return data.access_token;
}
