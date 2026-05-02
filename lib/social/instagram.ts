/**
 * Meta Graph API v20.0 client — native fetch only, no external dependencies.
 */

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

function getAppId(): string {
  const id = process.env.META_APP_ID;
  if (!id) throw new Error("[instagram] META_APP_ID env var is not set");
  return id;
}

function getAppSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("[instagram] META_APP_SECRET env var is not set");
  return secret;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface IGPost {
  id: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  media_type: string;
}

export interface IGComment {
  id: string;
  text: string;
  timestamp: string;
  username?: string;
}

export interface IGAccount {
  id: string;
  name: string;
  username?: string;
  access_token: string;
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface GraphError {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

async function graphFetch<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = (await res.json()) as T | GraphError;

  if (!res.ok || "error" in (json as object)) {
    const err = (json as GraphError).error;
    throw new Error(
      `[instagram] Graph API error ${err?.code ?? res.status}: ${err?.message ?? res.statusText}`
    );
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Exchange a short-lived OAuth code for a short-lived user access token.
 * Redirect URI must exactly match the one registered in the Meta app dashboard.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; token_type: string }> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", getAppId());
  url.searchParams.set("client_secret", getAppSecret());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `[instagram] Token exchange failed: ${json.error?.message ?? res.statusText}`
    );
  }

  return { access_token: json.access_token, token_type: json.token_type ?? "bearer" };
}

/**
 * Exchange a short-lived user token for a long-lived token (60-day expiry).
 */
export async function getLongLivedToken(
  shortToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const data = await graphFetch<{ access_token: string; token_type: string; expires_in: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: getAppId(),
      client_secret: getAppSecret(),
      fb_exchange_token: shortToken,
    }
  );

  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * Given a user access token, find the connected Instagram Business / Creator account.
 * Walks the user's Facebook Pages → finds the IG account linked to each page.
 * Returns null if no IG business account is connected.
 */
export async function getConnectedIGAccount(
  userToken: string
): Promise<IGAccount | null> {
  // Step 1: get pages the user manages
  const pagesResponse = await graphFetch<{
    data: Array<{ id: string; name: string; access_token: string }>;
  }>("/me/accounts", { access_token: userToken, fields: "id,name,access_token" });

  const pages = pagesResponse.data ?? [];

  for (const page of pages) {
    // Step 2: check each page for a linked IG business account
    let igData: { instagram_business_account?: { id: string } } | null = null;

    try {
      igData = await graphFetch<{ instagram_business_account?: { id: string } }>(
        `/${page.id}`,
        {
          access_token: page.access_token,
          fields: "instagram_business_account",
        }
      );
    } catch {
      // Page may not have IG connected — skip it
      continue;
    }

    const igId = igData?.instagram_business_account?.id;
    if (!igId) continue;

    // Step 3: fetch account details
    const accountData = await graphFetch<{
      id: string;
      name: string;
      username?: string;
    }>(`/${igId}`, {
      access_token: page.access_token,
      fields: "id,name,username",
    });

    return {
      id: accountData.id,
      name: accountData.name,
      username: accountData.username,
      access_token: page.access_token,
    };
  }

  return null;
}

/**
 * Fetch recent media posts for an IG user account.
 */
export async function fetchPosts(
  igUserId: string,
  accessToken: string,
  limit = 25
): Promise<IGPost[]> {
  const fields =
    "id,caption,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,media_type";

  const response = await graphFetch<{ data: IGPost[] }>(
    `/${igUserId}/media`,
    {
      access_token: accessToken,
      fields,
      limit: String(limit),
    }
  );

  return response.data ?? [];
}

/**
 * Fetch top-level comments on a media post.
 * Note: Instagram Graph API only returns comments on Business/Creator accounts
 * where the token belongs to the account owner.
 */
export async function fetchComments(
  mediaId: string,
  accessToken: string
): Promise<IGComment[]> {
  const response = await graphFetch<{
    data: Array<{ id: string; text: string; timestamp: string; username?: string }>;
  }>(`/${mediaId}/comments`, {
    access_token: accessToken,
    fields: "id,text,timestamp,username",
  });

  return (response.data ?? []).map((c) => ({
    id: c.id,
    text: c.text,
    timestamp: c.timestamp,
    username: c.username,
  }));
}
