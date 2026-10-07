import 'server-only';
import sql from '@/lib/db';
import type { CommercialBudgetVersion } from './budgets';
import { logBudgetVersionActivated, logBudgetVersionSuperseded } from './auditLog';

export class BudgetActivationError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'NOT_DRAFT'
      | 'FINANCIAL_YEAR_CLOSED'
      | 'INACTIVE_REFERENCE'
      | 'INVALID_PERIOD_ALLOCATIONS'
      | 'PERIOD_OUTSIDE_YEAR',
    message: string,
  ) {
    super(message);
    this.name = 'BudgetActivationError';
  }
}

type ValidationRow = {
  budget_exists: boolean;
  target_exists: boolean;
  target_is_draft: boolean;
  financial_year_open: boolean;
  references_valid: boolean;
  allocation_shape_valid: boolean;
  allocation_periods_valid: boolean;
};

function assertValidation(v: ValidationRow | undefined): void {
  if (!v?.budget_exists || !v.target_exists) throw new BudgetActivationError('NOT_FOUND', 'Budget version not found for this organisation.');
  if (!v.target_is_draft) throw new BudgetActivationError('NOT_DRAFT', 'Only DRAFT budget versions can be activated.');
  if (!v.financial_year_open) throw new BudgetActivationError('FINANCIAL_YEAR_CLOSED', 'Budget financial year must be OPEN to activate a version.');
  if (!v.references_valid) throw new BudgetActivationError('INACTIVE_REFERENCE', 'Budget lines and mappings must reference active same-tenant accounts and cost centres.');
  if (!v.allocation_shape_valid) throw new BudgetActivationError('INVALID_PERIOD_ALLOCATIONS', 'Budget period allocations do not exactly match the periodisation rules.');
  if (!v.allocation_periods_valid) throw new BudgetActivationError('PERIOD_OUTSIDE_YEAR', 'Budget period allocations must belong to the Budget financial year.');
}

export async function activateBudgetVersion(params: {
  organisationId: string;
  userId: string;
  budgetId: string;
  budgetVersionId: string;
}): Promise<CommercialBudgetVersion> {
  const [lockRows, , , validationRows, supersededRows, activatedRows, pointerRows] = await sql.transaction(txn => [
    txn`
      WITH budget_guard AS MATERIALIZED (
        SELECT cb.id
        FROM commercial_budgets cb
        JOIN commercial_financial_years cfy
          ON cfy.id = cb.financial_year_id
         AND cfy.organisation_id = cb.organisation_id
        WHERE cb.id = ${params.budgetId}
          AND cb.organisation_id = ${params.organisationId}
        FOR UPDATE OF cb, cfy
      ),
      locked_versions AS MATERIALIZED (
        SELECT bv.id
        FROM commercial_budget_versions bv
        WHERE bv.budget_id = ${params.budgetId}
          AND bv.organisation_id = ${params.organisationId}
          AND EXISTS (SELECT 1 FROM budget_guard)
        ORDER BY bv.id
        FOR UPDATE
      )
      SELECT EXISTS (SELECT 1 FROM budget_guard) AS budget_locked,
             COUNT(*)::int AS locked_version_count
      FROM locked_versions
    `,
    // The version lock fixes its references before dimension locks are taken.
    // Deactivation takes the same row lock then checks ACTIVE references in a
    // separate statement, so either operation sees the other's committed state.
    txn`
      SELECT account.id FROM commercial_budget_accounts account
      WHERE account.organisation_id=${params.organisationId} AND (
        EXISTS(SELECT 1 FROM commercial_budget_lines line WHERE line.budget_version_id=${params.budgetVersionId} AND line.organisation_id=account.organisation_id AND line.budget_account_id=account.id)
        OR EXISTS(SELECT 1 FROM commercial_budget_commitment_mappings mapping WHERE mapping.budget_version_id=${params.budgetVersionId} AND mapping.organisation_id=account.organisation_id AND mapping.budget_account_id=account.id)
      ) ORDER BY account.id FOR UPDATE OF account
    `,
    txn`
      SELECT centre.id FROM commercial_cost_centres centre
      WHERE centre.organisation_id=${params.organisationId} AND (
        EXISTS(SELECT 1 FROM commercial_budget_lines line WHERE line.budget_version_id=${params.budgetVersionId} AND line.organisation_id=centre.organisation_id AND line.cost_centre_id=centre.id)
        OR EXISTS(SELECT 1 FROM commercial_budget_commitment_mappings mapping WHERE mapping.budget_version_id=${params.budgetVersionId} AND mapping.organisation_id=centre.organisation_id AND mapping.cost_centre_id=centre.id)
      ) ORDER BY centre.id FOR UPDATE OF centre
    `,
    txn`
      SELECT
        EXISTS (
          SELECT 1 FROM commercial_budgets cb
          WHERE cb.id = ${params.budgetId} AND cb.organisation_id = ${params.organisationId}
        ) AS budget_exists,
        EXISTS (
          SELECT 1 FROM commercial_budget_versions bv
          WHERE bv.id = ${params.budgetVersionId}
            AND bv.budget_id = ${params.budgetId}
            AND bv.organisation_id = ${params.organisationId}
        ) AS target_exists,
        EXISTS (
          SELECT 1 FROM commercial_budget_versions bv
          WHERE bv.id = ${params.budgetVersionId}
            AND bv.budget_id = ${params.budgetId}
            AND bv.organisation_id = ${params.organisationId}
            AND bv.status = 'DRAFT'
        ) AS target_is_draft,
        EXISTS (
          SELECT 1
          FROM commercial_budgets cb
          JOIN commercial_financial_years cfy
            ON cfy.id = cb.financial_year_id
           AND cfy.organisation_id = cb.organisation_id
          WHERE cb.id = ${params.budgetId}
            AND cb.organisation_id = ${params.organisationId}
            AND cfy.status = 'OPEN'
        ) AS financial_year_open,
        NOT EXISTS (
          SELECT 1
          FROM commercial_budget_lines bl
          LEFT JOIN commercial_budget_accounts ba
            ON ba.id = bl.budget_account_id AND ba.organisation_id = bl.organisation_id
          LEFT JOIN commercial_cost_centres cc
            ON cc.id = bl.cost_centre_id AND cc.organisation_id = bl.organisation_id
          WHERE bl.budget_version_id = ${params.budgetVersionId}
            AND bl.organisation_id = ${params.organisationId}
            AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM commercial_budget_commitment_mappings bcm
          LEFT JOIN commercial_budget_accounts ba
            ON ba.id = bcm.budget_account_id AND ba.organisation_id = bcm.organisation_id
          LEFT JOIN commercial_cost_centres cc
            ON cc.id = bcm.cost_centre_id AND cc.organisation_id = bcm.organisation_id
          WHERE bcm.budget_version_id = ${params.budgetVersionId}
            AND bcm.organisation_id = ${params.organisationId}
            AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
        ) AS references_valid,
        CASE
          WHEN (
            SELECT cb.periodisation_mode FROM commercial_budgets cb
            WHERE cb.id = ${params.budgetId} AND cb.organisation_id = ${params.organisationId}
          ) = 'ANNUAL_ONLY'
          THEN NOT EXISTS (
            SELECT 1
            FROM commercial_budget_period_allocations bpa
            JOIN commercial_budget_lines bl
              ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
            WHERE bl.budget_version_id = ${params.budgetVersionId}
              AND bl.organisation_id = ${params.organisationId}
          )
          ELSE NOT EXISTS (
            SELECT 1
            FROM commercial_budget_lines bl
            LEFT JOIN commercial_budget_period_allocations bpa
              ON bpa.budget_line_id = bl.id AND bpa.organisation_id = bl.organisation_id
            WHERE bl.budget_version_id = ${params.budgetVersionId}
              AND bl.organisation_id = ${params.organisationId}
            GROUP BY bl.id, bl.annual_budget_cents
            HAVING COALESCE(SUM(bpa.amount_cents), 0) <> bl.annual_budget_cents
          )
        END AS allocation_shape_valid,
        NOT EXISTS (
          SELECT 1
          FROM commercial_budget_period_allocations bpa
          JOIN commercial_budget_lines bl
            ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
          JOIN commercial_financial_periods cfp
            ON cfp.id = bpa.financial_period_id AND cfp.organisation_id = bpa.organisation_id
          JOIN commercial_budgets cb
            ON cb.id = ${params.budgetId} AND cb.organisation_id = ${params.organisationId}
          WHERE bl.budget_version_id = ${params.budgetVersionId}
            AND bl.organisation_id = ${params.organisationId}
            AND cfp.financial_year_id <> cb.financial_year_id
        ) AS allocation_periods_valid
    `,

    txn`
      UPDATE commercial_budget_versions prior
      SET status = 'SUPERSEDED', superseded_at = now()
      WHERE prior.budget_id = ${params.budgetId}
        AND prior.organisation_id = ${params.organisationId}
        AND prior.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1
          FROM commercial_budget_versions target
          JOIN commercial_budgets cb
            ON cb.id = target.budget_id AND cb.organisation_id = target.organisation_id
          JOIN commercial_financial_years cfy
            ON cfy.id = cb.financial_year_id AND cfy.organisation_id = cb.organisation_id
          WHERE target.id = ${params.budgetVersionId}
            AND target.budget_id = ${params.budgetId}
            AND target.organisation_id = ${params.organisationId}
            AND target.status = 'DRAFT'
            AND cfy.status = 'OPEN'
            AND NOT EXISTS (
              SELECT 1 FROM commercial_budget_lines bl
              LEFT JOIN commercial_budget_accounts ba ON ba.id = bl.budget_account_id AND ba.organisation_id = bl.organisation_id
              LEFT JOIN commercial_cost_centres cc ON cc.id = bl.cost_centre_id AND cc.organisation_id = bl.organisation_id
              WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
                AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
            )
            AND NOT EXISTS (
              SELECT 1 FROM commercial_budget_commitment_mappings bcm
              LEFT JOIN commercial_budget_accounts ba ON ba.id = bcm.budget_account_id AND ba.organisation_id = bcm.organisation_id
              LEFT JOIN commercial_cost_centres cc ON cc.id = bcm.cost_centre_id AND cc.organisation_id = bcm.organisation_id
              WHERE bcm.budget_version_id = target.id AND bcm.organisation_id = target.organisation_id
                AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
            )
            AND (
              (cb.periodisation_mode = 'ANNUAL_ONLY' AND NOT EXISTS (
                SELECT 1 FROM commercial_budget_period_allocations bpa
                JOIN commercial_budget_lines bl ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
                WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
              ))
              OR
              (cb.periodisation_mode = 'PERIODISED' AND NOT EXISTS (
                SELECT 1 FROM commercial_budget_lines bl
                LEFT JOIN commercial_budget_period_allocations bpa
                  ON bpa.budget_line_id = bl.id AND bpa.organisation_id = bl.organisation_id
                WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
                GROUP BY bl.id, bl.annual_budget_cents
                HAVING COALESCE(SUM(bpa.amount_cents), 0) <> bl.annual_budget_cents
              ))
            )
            AND NOT EXISTS (
              SELECT 1 FROM commercial_budget_period_allocations bpa
              JOIN commercial_budget_lines bl ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
              JOIN commercial_financial_periods cfp ON cfp.id = bpa.financial_period_id AND cfp.organisation_id = bpa.organisation_id
              WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
                AND cfp.financial_year_id <> cb.financial_year_id
            )
        )
      RETURNING prior.id
    `,

    txn`
      UPDATE commercial_budget_versions target
      SET status = 'ACTIVE',
          activated_by = ${params.userId},
          activated_at = now(),
          superseded_at = NULL
      FROM commercial_budgets cb
      JOIN commercial_financial_years cfy
        ON cfy.id = cb.financial_year_id AND cfy.organisation_id = cb.organisation_id
      WHERE target.id = ${params.budgetVersionId}
        AND target.budget_id = ${params.budgetId}
        AND target.organisation_id = ${params.organisationId}
        AND target.status = 'DRAFT'
        AND cb.id = target.budget_id
        AND cb.organisation_id = target.organisation_id
        AND cfy.status = 'OPEN'
        AND NOT EXISTS (
          SELECT 1 FROM commercial_budget_lines bl
          LEFT JOIN commercial_budget_accounts ba ON ba.id = bl.budget_account_id AND ba.organisation_id = bl.organisation_id
          LEFT JOIN commercial_cost_centres cc ON cc.id = bl.cost_centre_id AND cc.organisation_id = bl.organisation_id
          WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
            AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
        )
        AND NOT EXISTS (
          SELECT 1 FROM commercial_budget_commitment_mappings bcm
          LEFT JOIN commercial_budget_accounts ba ON ba.id = bcm.budget_account_id AND ba.organisation_id = bcm.organisation_id
          LEFT JOIN commercial_cost_centres cc ON cc.id = bcm.cost_centre_id AND cc.organisation_id = bcm.organisation_id
          WHERE bcm.budget_version_id = target.id AND bcm.organisation_id = target.organisation_id
            AND (ba.id IS NULL OR ba.active = false OR cc.id IS NULL OR cc.active = false)
        )
        AND (
          (cb.periodisation_mode = 'ANNUAL_ONLY' AND NOT EXISTS (
            SELECT 1 FROM commercial_budget_period_allocations bpa
            JOIN commercial_budget_lines bl ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
            WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
          ))
          OR
          (cb.periodisation_mode = 'PERIODISED' AND NOT EXISTS (
            SELECT 1 FROM commercial_budget_lines bl
            LEFT JOIN commercial_budget_period_allocations bpa
              ON bpa.budget_line_id = bl.id AND bpa.organisation_id = bl.organisation_id
            WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
            GROUP BY bl.id, bl.annual_budget_cents
            HAVING COALESCE(SUM(bpa.amount_cents), 0) <> bl.annual_budget_cents
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM commercial_budget_period_allocations bpa
          JOIN commercial_budget_lines bl ON bl.id = bpa.budget_line_id AND bl.organisation_id = bpa.organisation_id
          JOIN commercial_financial_periods cfp ON cfp.id = bpa.financial_period_id AND cfp.organisation_id = bpa.organisation_id
          WHERE bl.budget_version_id = target.id AND bl.organisation_id = target.organisation_id
            AND cfp.financial_year_id <> cb.financial_year_id
        )
      RETURNING target.*
    `,
    txn`
      UPDATE commercial_budgets cb
      SET active_version_id = ${params.budgetVersionId}, updated_at = now()
      WHERE cb.id = ${params.budgetId}
        AND cb.organisation_id = ${params.organisationId}
        AND EXISTS (
          SELECT 1 FROM commercial_budget_versions bv
          WHERE bv.id = ${params.budgetVersionId}
            AND bv.budget_id = cb.id
            AND bv.organisation_id = cb.organisation_id
            AND bv.status = 'ACTIVE'
        )
      RETURNING cb.id
    `,
  ], { isolationLevel: 'ReadCommitted' });

  void lockRows;
  const validation = (validationRows as ValidationRow[])[0];
  const activated = (activatedRows as CommercialBudgetVersion[])[0];
  const pointerUpdated = (pointerRows as { id: string }[]).length === 1;

  if (!activated || !pointerUpdated) {
    assertValidation(validation);
    throw new BudgetActivationError('NOT_DRAFT', 'Budget version activation did not complete.');
  }

  const previousActiveVersionId = ((supersededRows as { id: string }[])[0]?.id) ?? null;
  if (previousActiveVersionId) {
    await logBudgetVersionSuperseded({
      organisationId: params.organisationId,
      userId: params.userId,
      budgetVersionId: previousActiveVersionId,
      replacementVersionId: activated.id,
    });
  }
  await logBudgetVersionActivated({
    organisationId: params.organisationId,
    userId: params.userId,
    budgetVersionId: activated.id,
    budgetId: activated.budget_id,
    previousActiveVersionId,
    versionNumber: activated.version_number,
  });
  return activated;
}
