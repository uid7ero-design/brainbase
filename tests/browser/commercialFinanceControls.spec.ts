import { expect, test, type Page } from '@playwright/test';
import {
  financePeriodCloseHref,
  financePeriodReopenHref,
  financeReconciliationAction,
  financeReconciliationReviewHref,
  financeReconciliationSignOffHref,
  type FinanceReconciliationControlStatus,
} from '../../lib/commercial/financeControlUi';

async function fulfillPost(page: Page, path: string) {
  await page.route(`http://brainbase.local${path}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
}

async function mountFinanceControls(
  page: Page,
  options: {
    periodId?: string;
    periodStatus?: 'OPEN' | 'CLOSED';
    reconciliationId?: string;
    reconciliationStatus?: FinanceReconciliationControlStatus;
    activeCloseId?: string | null;
  } = {},
) {
  const periodId = options.periodId ?? 'period/sep';
  const periodStatus = options.periodStatus ?? 'OPEN';
  const reconciliationId = options.reconciliationId ?? 'recon/1';
  const activeCloseId = options.activeCloseId ?? null;
  const action = options.reconciliationStatus
    ? financeReconciliationAction(options.reconciliationStatus, Boolean(activeCloseId))
    : null;

  const periodControl = periodStatus === 'OPEN'
    ? `
      <label>Close reason <input id="close-reason"></label>
      <button id="close-period">Close period</button>
    `
    : `
      <form id="reopen-form">
        <label>Reopen reason <input id="reopen-reason" required></label>
        <button id="reopen-period" type="submit" disabled>Reopen period</button>
      </form>
    `;

  const reconciliationControl = !action
    ? ''
    : action === 'REVIEW'
      ? '<button id="review-reconciliation">Review</button>'
      : action === 'SIGN_OFF' || action === 'SIGN_OFF_BLOCKED'
        ? `<button id="signoff-reconciliation" ${action === 'SIGN_OFF_BLOCKED' ? 'disabled' : ''}>Sign off</button>`
        : '<span id="read-only">Read only</span>';

  await page.setContent(`
    <base href="http://brainbase.local/">
    <section>
      ${periodControl}
      <form id="prepare-form">
        <select id="source"><option value="">Choose source</option><option value="xero">xero</option></select>
        <input id="currency" maxlength="3">
        <textarea id="notes"></textarea>
        <button id="prepare-reconciliation" type="submit">Prepare reconciliation</button>
        <span id="prepare-error"></span>
      </form>
      ${reconciliationControl}
    </section>
    <script>
      (() => {
      const periodId = ${JSON.stringify(periodId)};
      const reconciliationId = ${JSON.stringify(reconciliationId)};
      const activeCloseId = ${JSON.stringify(activeCloseId)};

      const closeButton = document.getElementById('close-period');
      if (closeButton) {
        closeButton.addEventListener('click', async () => {
          const reason = document.getElementById('close-reason').value.trim();
          await fetch(${JSON.stringify(financePeriodCloseHref(periodId))}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason || null }),
          });
        });
      }

      const reopenInput = document.getElementById('reopen-reason');
      const reopenButton = document.getElementById('reopen-period');
      if (reopenInput && reopenButton) {
        reopenInput.addEventListener('input', () => {
          reopenButton.disabled = !reopenInput.value.trim();
        });
        document.getElementById('reopen-form').addEventListener('submit', async event => {
          event.preventDefault();
          const reason = reopenInput.value.trim();
          if (!reason) return;
          await fetch(${JSON.stringify(financePeriodReopenHref(periodId))}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          });
        });
      }

      document.getElementById('currency').addEventListener('input', event => {
        event.target.value = event.target.value.toUpperCase();
      });
      document.getElementById('prepare-form').addEventListener('submit', async event => {
        event.preventDefault();
        const sourceSystemId = document.getElementById('source').value;
        const currency = document.getElementById('currency').value.trim().toUpperCase();
        const notes = document.getElementById('notes').value.trim();
        if (!sourceSystemId || !/^[A-Z]{3}$/.test(currency)) {
          document.getElementById('prepare-error').textContent =
            'Choose a period and source, and enter a three-letter currency code.';
          return;
        }
        await fetch('/api/commercial/budgeting/reconciliations/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            financialPeriodId: periodId,
            sourceSystemId,
            currency,
            notes: notes || null,
          }),
        });
      });

      const review = document.getElementById('review-reconciliation');
      if (review) {
        review.addEventListener('click', async () => {
          await fetch(${JSON.stringify(financeReconciliationReviewHref(reconciliationId))}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
        });
      }

      const signoff = document.getElementById('signoff-reconciliation');
      if (signoff) {
        signoff.addEventListener('click', async () => {
          if (!activeCloseId) return;
          await fetch(${JSON.stringify(financeReconciliationSignOffHref(reconciliationId))}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ closeId: activeCloseId }),
          });
        });
      }
      })();
    </script>
  `);
}

test.describe('C7.9 Finance Controls browser flow', () => {
  test('closes an open period through the governed endpoint with the entered reason', async ({ page }) => {
    const periodId = 'period/sep';
    const path = financePeriodCloseHref(periodId);
    await fulfillPost(page, path);
    await mountFinanceControls(page, { periodId, periodStatus: 'OPEN' });

    await page.locator('#close-reason').fill('Month end');
    const requestPromise = page.waitForRequest(
      request => request.url() === `http://brainbase.local${path}`,
    );
    await page.locator('#close-period').click();
    const request = await requestPromise;

    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({ reason: 'Month end' });
  });

  test('requires a reopen reason before posting to the governed reopen endpoint', async ({ page }) => {
    const periodId = 'period/sep';
    const path = financePeriodReopenHref(periodId);
    await fulfillPost(page, path);
    await mountFinanceControls(page, { periodId, periodStatus: 'CLOSED' });

    await expect(page.locator('#reopen-period')).toBeDisabled();
    await page.locator('#reopen-reason').fill('Correction required');
    await expect(page.locator('#reopen-period')).toBeEnabled();

    const requestPromise = page.waitForRequest(
      request => request.url() === `http://brainbase.local${path}`,
    );
    await page.locator('#reopen-period').click();
    const request = await requestPromise;

    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({ reason: 'Correction required' });
  });

  test('blocks invalid reconciliation preparation and posts normalized valid input', async ({ page }) => {
    await fulfillPost(page, '/api/commercial/budgeting/reconciliations/prepare');
    await mountFinanceControls(page, { periodId: 'period-1' });

    await page.locator('#source').selectOption('xero');
    await page.locator('#currency').fill('AU');
    await page.locator('#prepare-reconciliation').click();
    await expect(page.locator('#prepare-error')).toHaveText(
      'Choose a period and source, and enter a three-letter currency code.',
    );

    await page.locator('#currency').fill('aud');
    await page.locator('#notes').fill('  Month-end check  ');
    const requestPromise = page.waitForRequest(
      request => request.url() === 'http://brainbase.local/api/commercial/budgeting/reconciliations/prepare',
    );
    await page.locator('#prepare-reconciliation').click();
    const request = await requestPromise;

    expect(request.postDataJSON()).toEqual({
      financialPeriodId: 'period-1',
      sourceSystemId: 'xero',
      currency: 'AUD',
      notes: 'Month-end check',
    });
  });

  test('reviews PREPARED reconciliation through the exact lifecycle endpoint', async ({ page }) => {
    const reconciliationId = 'recon/1';
    const path = financeReconciliationReviewHref(reconciliationId);
    await fulfillPost(page, path);
    await mountFinanceControls(page, {
      reconciliationId,
      reconciliationStatus: 'PREPARED',
    });

    const requestPromise = page.waitForRequest(
      request => request.url() === `http://brainbase.local${path}`,
    );
    await page.locator('#review-reconciliation').click();
    const request = await requestPromise;

    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({});
  });

  test('blocks REVIEWED sign-off without a current close and posts the exact close when available', async ({ page }) => {
    await mountFinanceControls(page, {
      reconciliationStatus: 'REVIEWED',
      activeCloseId: null,
    });
    await expect(page.locator('#signoff-reconciliation')).toBeDisabled();

    const reconciliationId = 'recon/1';
    const closeId = 'close-2';
    const path = financeReconciliationSignOffHref(reconciliationId);
    await fulfillPost(page, path);
    await mountFinanceControls(page, {
      reconciliationId,
      reconciliationStatus: 'REVIEWED',
      activeCloseId: closeId,
    });
    await expect(page.locator('#signoff-reconciliation')).toBeEnabled();

    const requestPromise = page.waitForRequest(
      request => request.url() === `http://brainbase.local${path}`,
    );
    await page.locator('#signoff-reconciliation').click();
    const request = await requestPromise;

    expect(request.postDataJSON()).toEqual({ closeId });
  });

  test('keeps SIGNED_OFF and STALE reconciliation states read only', async ({ page }) => {
    for (const status of ['SIGNED_OFF', 'STALE'] as const) {
      await mountFinanceControls(page, {
        reconciliationStatus: status,
        activeCloseId: 'close-1',
      });

      await expect(page.locator('#read-only')).toHaveText('Read only');
      await expect(page.locator('#review-reconciliation')).toHaveCount(0);
      await expect(page.locator('#signoff-reconciliation')).toHaveCount(0);
    }
  });
});
