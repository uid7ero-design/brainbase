import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { parse } from 'csv-parse/sync';

// Called only inside the existing owned disposable-database/runtime harness.
export async function verifyFinanceEvidenceRuntime({page,foreignPage,pool,artifacts}){
  // Use browser fetch so Chromium's secure localhost session-cookie handling
  // matches the UI; APIRequestContext handles secure HTTP cookies differently.
  const get=(target,path)=>target.evaluate(async url=>{const response=await fetch(url);return {status:response.status,cacheControl:response.headers.get('Cache-Control'),body:await response.json()};},path);
  const rows=(await pool.query("SELECT r.*,p.financial_year_id FROM commercial_finance_reconciliations r JOIN commercial_financial_periods p ON p.id=r.financial_period_id WHERE r.organisation_id='runtime-a' ORDER BY r.prepared_at DESC,r.id DESC")).rows;
  if(rows.length<2)throw new Error('Evidence acceptance requires two saved disposable snapshots');
  const latest=rows[0],baseline=rows.find(row=>row.id!==latest.id),params=new URLSearchParams({yearId:latest.financial_year_id,periodId:latest.financial_period_id,source:latest.source_system_id,currency:latest.currency});
  const state=async()=>JSON.stringify((await pool.query("SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM commercial_finance_reconciliations r) AS records,(SELECT count(*)::int FROM commercial_finance_reconciliation_events) AS events,(SELECT count(*)::int FROM commercial_finance_adjustment_events) AS adjustments")).rows[0]);
  const before=await state(),methods=[];const observe=request=>{if(request.url().includes('/api/commercial/budgeting/'))methods.push(request.method());};page.on('request',observe);
  const download=async(panel,label,name)=>{const waiting=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();const item=await waiting;const path=resolve(artifacts,name);await item.saveAs(path);return readFileSync(path,'utf8');};
  try{
    const read=await get(page,'/api/commercial/budgeting/reconciliations/evidence?'+params+'&id='+latest.id);expect(read.status).toBe(200);expect(read.cacheControl).toBe('no-store');const evidence=read.body.evidence;
    expect(evidence.header.id).toBe(latest.id);expect(evidence.header.sourceActualCents).toBe(latest.source_actual_cents);expect(evidence.totalCount).toBe(evidence.items.length);
    const foreign=await get(foreignPage,'/api/commercial/budgeting/reconciliations/evidence?'+params+'&id='+latest.id);expect(foreign.status).toBe(404);
    const foreignHistory=await get(foreignPage,'/api/commercial/budgeting/reconciliations/history?'+params);expect(foreignHistory.body.history.totalCount).toBe(0);
    const history=page.getByRole('region',{name:'Saved reconciliation history',exact:true});await history.getByRole('button',{name:'Show saved reconciliation history',exact:true}).click();
    await expect(history.getByRole('article',{name:`Saved snapshot ${latest.id}`,exact:true})).toBeVisible();
    await history.getByText('Download displayed history page',{exact:true}).click();const historyHtml=await download(history,'Download printable history report','evidence-history.html');expect(historyHtml).toContain(latest.id);expect(historyHtml).toContain(baseline.id);
    await history.getByRole('button',{name:`Use reconciliation ${baseline.id} as baseline`,exact:true}).click();await history.getByRole('button',{name:`Compare reconciliation ${latest.id} to selected baseline`,exact:true}).click();
    const comparison=history.getByRole('region',{name:'Saved snapshot total comparison',exact:true});await expect(comparison.getByRole('button',{name:'Swap baseline and comparison (reload)',exact:true})).toBeVisible();
    await comparison.getByText('Download comparison evidence',{exact:true}).click();const compared=JSON.parse(await download(comparison,'Download comparison JSON','evidence-comparison.json'));
    expect(compared.comparison.baseline.header.id).toBe(baseline.id);expect(compared.comparison.comparison.header.id).toBe(latest.id);expect(compared.comparison.changes.sourceActualCents).toBe((BigInt(latest.source_actual_cents)-BigInt(baseline.source_actual_cents)).toString());
    await comparison.getByRole('button',{name:'Swap baseline and comparison (reload)',exact:true}).click();await expect(comparison.getByRole('button',{name:'Swap baseline and comparison (reload)',exact:true})).toBeVisible();await comparison.getByText('Download comparison evidence',{exact:true}).click();
    const swapped=JSON.parse(await download(comparison,'Download comparison JSON','evidence-comparison-swapped.json'));expect(swapped.comparison.baseline.header.id).toBe(latest.id);expect(swapped.comparison.comparison.header.id).toBe(baseline.id);
    await comparison.getByRole('button',{name:'Inspect comparison evidence',exact:true}).click();const explorer=page.getByRole('region',{name:'Finance evidence inspection',exact:true});const saved=explorer.getByRole('region',{name:'Saved reconciliation evidence',exact:true});await expect(saved.getByText('Lifecycle history',{exact:true})).toBeVisible();
    await saved.getByText('Download saved reconciliation evidence',{exact:true}).click();const html=await download(saved,'Download printable evidence report','evidence-snapshot.html');expect(html).toContain(baseline.id);expect(html).toContain('Item coverage: selected page 1');
    const snapshot=JSON.parse(await download(saved,'Download evidence page JSON','evidence-snapshot.json'));expect(snapshot.evidence.header.id).toBe(baseline.id);
    const totals=parse(await download(saved,'Export all-item totals summary CSV','evidence-totals.csv'),{columns:true,bom:true});expect(totals).toHaveLength(5);expect(totals[0]['Saved header cents']).toBe("'"+baseline.source_actual_cents);
    const reportPage=await page.context().newPage();await reportPage.setContent(html);await reportPage.setViewportSize({width:390,height:844});expect(await reportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await reportPage.screenshot({path:resolve(artifacts,'evidence-report-mobile.png'),fullPage:true});await reportPage.emulateMedia({media:'print'});await reportPage.pdf({path:resolve(artifacts,'evidence-report-print.pdf'),format:'A4'});await reportPage.close();
    const closeButton=saved.getByRole('button',{name:'Inspect close referenced by this event',exact:true}).first();await expect(closeButton).toBeVisible();await closeButton.click();const close=explorer.getByRole('region',{name:'Saved close evidence',exact:true});await expect(close.getByText('Control totals captured at close',{exact:true})).toBeVisible();await close.getByText('Download saved close evidence',{exact:true}).click();const closeJson=JSON.parse(await download(close,'Download complete close record JSON','evidence-close.json'));expect(closeJson.evidence.status).toBe('INVALIDATED');
    await explorer.getByRole('button',{name:'Back to previous evidence',exact:true}).first().click();await expect(saved.getByText('Lifecycle history',{exact:true})).toBeVisible();await explorer.getByRole('button',{name:'Forward to next evidence',exact:true}).click();await expect(close.getByText('Control totals captured at close',{exact:true})).toBeVisible();
    await explorer.getByRole('button',{name:'Return to originating history',exact:true}).first().click();await history.getByRole('button',{name:'Close total comparison',exact:true}).click();await history.getByRole('button',{name:'Hide saved reconciliation history',exact:true}).click();
    if(methods.some(method=>method!=='GET')||await state()!==before)throw new Error('Read-only evidence acceptance changed finance state or issued a mutation');
    writeFileSync(resolve(artifacts,'finance-evidence-acceptance.json'),JSON.stringify({passed:true,scope:Object.fromEntries(params),latest:latest.id,baseline:baseline.id,checks:['native scoped reads and foreign-tenant rejection','history HTML','comparison direction and swap','snapshot HTML/JSON/CSV','mobile report and print PDF','event-linked invalidated close','Back/Forward fresh reads','GET-only browser requests and unchanged database facts/events']},null,2));
    console.log('Finance evidence candidate acceptance passed');
  }finally{page.off('request',observe);}
}
