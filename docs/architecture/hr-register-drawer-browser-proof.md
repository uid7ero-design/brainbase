# Register drawer keyboard recovery

Closing a person drawer refreshes its register. The refresh replaces the table rows, removing the original opener after the dialog's focus cleanup. Real Chromium verification exposed lost keyboard focus after this replacement.

People, lifecycle overview, task queue and document assurance now restore focus after the refreshed view settles. If the selected person's opener is still visible, it receives focus. Otherwise the stable Refresh button is the fallback, including a failed read. Restoration is cancelled when another drawer opens and does not override focus moved to another control during loading. The helper stores only the selected person ID in component-local refs; it does not persist searches or change authority, requests or mutations.

The browser harness includes two additional flows that compile and execute the real People page, person drawer, dialog focus handling and assistant UI. One covers document-access denial and keyboard close/refresh; the other covers generic person-load failure, reopening recovery and keyboard close/refresh. HTTP uses synthetic fixtures, Next Link is substituted and PersonForm is inert. The assistant is rendered but never submitted; traffic must be GET-only. No live database, HR records or model provider is used. This is not authenticated deployment verification or a write-path certification.

The preceding four register flows retain their drawer seams. Focus-helper component checks cover replacement-row focus, missing-row/error fallback, respect for intervening user focus and cancellation on another drawer opening. Existing register component tests remain part of verification.

Release requires a checked PR head and explicit approval; the previous authorization applied to PR #423 only. Main automatically deploys production.
