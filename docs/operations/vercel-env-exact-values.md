# Vercel env: setting exact values

Some BrainBase flags are compared **exactly**, with no trimming:

- `EVE_PAID_CHECKOUT_ENABLED` must be the string `true`.
- `EVE_PAID_CHECKOUT_ORGS` must be comma-separated lowercase organisation slugs, e.g. `brainbase`.
- `EVE_LEGAL_PUBLISHED` follows the same exact-match rule.

Any other value, including the correct value plus whitespace, fails closed. Checkout stays at 503 "Paid checkout is not currently available."

## What went wrong once (2026-10-22, live $1 proof)

```powershell
'true' | vercel env add EVE_PAID_CHECKOUT_ENABLED production   # DON'T
```

PowerShell sends piped strings to a native program with a trailing newline. The stored values were `true` and `brainbase` plus a newline. After a redeploy, Brainbase checkout still returned 503. This was the fail-closed check working as designed, not an outage.

## Do

- Set values explicitly, never by pipe:

  ```powershell
  vercel env add EVE_PAID_CHECKOUT_ORGS production --value brainbase --force --yes
  vercel env add EVE_PAID_CHECKOUT_ENABLED production --value true --force --yes
  ```

  Or type the value in the Vercel dashboard (Project → Settings → Environment Variables).
- Remove a flag with `vercel env rm EVE_PAID_CHECKOUT_ENABLED production --yes`.
- Env changes only take effect on a **new deployment**. Re-read the current Production deployment right before redeploying (`vercel inspect https://www.thebrainbase.com.au`), then `vercel redeploy <that url> --target production`. Never redeploy a deployment id saved earlier; it may be older than current main.
- **Verify by behaviour, not by listing.** `vercel env ls` shows the name, not the value. After the redeploy, probe each organisation (see the launch runbook):
  - an allowed org gets past the switch (400 asking for terms acceptance on an empty body);
  - every other org stays 503.

## Don't

- Don't pipe (`|`), `echo`, or here-string values into `vercel env add`.
- Don't `vercel env pull` Production.
- Don't treat a 503 after enabling as an outage. First suspect a malformed value, re-set it with `--value`, and redeploy.
