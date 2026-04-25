import fs   from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(process.cwd(), '.brainbase', 'gcal_tokens.json');
const TOKEN_URL  = 'https://oauth2.googleapis.com/token';

export type GCalTokens = {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;
  email:         string;
};

type TokenStore = Record<string, GCalTokens>;

function readStore(): TokenStore {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    // Migrate old single-account format
    if (raw.access_token && raw.email) {
      return { [raw.email]: raw as GCalTokens };
    }
    return raw as TokenStore;
  } catch { return {}; }
}

function writeStore(store: TokenStore) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

export function readAllTokens(): GCalTokens[] {
  return Object.values(readStore());
}

export function writeTokens(tokens: GCalTokens) {
  const store = readStore();
  store[tokens.email] = tokens;
  writeStore(store);
}

export function clearTokens(email?: string) {
  if (!email) {
    try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {}
    return;
  }
  const store = readStore();
  delete store[email];
  writeStore(store);
}

async function refreshToken(tokens: GCalTokens): Promise<GCalTokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id:     process.env.GCAL_CLIENT_ID!,
      client_secret: process.env.GCAL_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at:    Date.now() + (data.expires_in ?? 3600) * 1000,
    email:         tokens.email,
  };
}

export async function getValidAccessTokens(): Promise<Array<{ email: string; token: string }>> {
  const store  = readStore();
  const result: Array<{ email: string; token: string }> = [];

  for (const [email, tokens] of Object.entries(store)) {
    if (Date.now() < tokens.expires_at - 60_000) {
      result.push({ email, token: tokens.access_token });
      continue;
    }
    const refreshed = await refreshToken(tokens);
    if (refreshed) {
      store[email] = refreshed;
      result.push({ email, token: refreshed.access_token });
    }
  }

  writeStore(store);
  return result;
}

// Back-compat for single-token routes (login check etc.)
export function readTokens(): GCalTokens | null {
  const all = readAllTokens();
  return all[0] ?? null;
}
