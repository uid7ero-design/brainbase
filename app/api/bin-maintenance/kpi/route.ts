import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { prisma } from '@/lib/prisma';
import {
  computeBinMaintenanceKpi,
  computeCompliance,
  computeCategoryStreamCrossTab,
  computePatterns,
  computeProjections,
  computeAdditionalCancel,
  computeDamagedParts,
  computeMissedCollections,
  computeDashboardHeaderStats,
  computeScheduleStatus,
  computeStreamStats,
  computeRepeatProperties,
  computeCompletionTrend,
  isAdditionalCancel,
} from '@/modules/bin-maintenance/calculations';

export async function GET(req: Request) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  const gte = from ? new Date(`${from}T00:00:00`) : undefined;
  const lte = to   ? new Date(`${to}T23:59:59.999`) : undefined;

  const jobs = await prisma.binMaintenanceJob.findMany({
    where: {
      organisation_id: session.organisationId,
      ...((gte || lte) ? { created_at: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } } : {}),
    },
    select: {
      id:             true,
      suburb:         true,
      address:        true,
      issue_type:     true,
      bin_type:       true,
      status:         true,
      severity:       true,
      scheduled_date: true,
      created_at:     true,
      completed_date: true,
      assigned_to:    true,
      notes:          true,
    },
  });

  if (jobs.length === 0) {
    return NextResponse.json({ hasData: false });
  }

  // Additional Cancel is schedule-dependent, not a maintenance SLA — excluded from
  // every other tab's stats and reported on its own.
  const mainJobs = jobs.filter(j => !isAdditionalCancel(j.issue_type));
  const acJobs   = jobs.filter(j =>  isAdditionalCancel(j.issue_type));

  return NextResponse.json({
    hasData: true,
    ...computeBinMaintenanceKpi(mainJobs),
    compliance: computeCompliance(mainJobs),
    category_stream: computeCategoryStreamCrossTab(mainJobs),
    patterns: computePatterns(mainJobs),
    projections: computeProjections(mainJobs),
    additional_cancel: computeAdditionalCancel(acJobs),
    damaged_parts: computeDamagedParts(mainJobs),
    missed_collections: computeMissedCollections(mainJobs),
    dashboard_header: computeDashboardHeaderStats(mainJobs),
    schedule_status: computeScheduleStatus(mainJobs),
    stream_stats: computeStreamStats(mainJobs),
    repeat_properties: computeRepeatProperties(mainJobs),
    completion_trend: computeCompletionTrend(mainJobs),
  });
}
