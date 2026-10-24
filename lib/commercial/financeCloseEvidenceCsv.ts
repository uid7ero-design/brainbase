import { buildCsv,type CsvCell } from '@/lib/events/csvExport';
import { closeControlSummary,type CloseEvidence } from './financeCloseEvidenceModel';

export type CloseEvidenceCsvKind='record-csv'|'totals-csv'|'links-csv';
const protect=(cell:CsvCell):CsvCell=>typeof cell==='string'&&(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)||/^\d+(?:\.\d+)?$/.test(cell))?`'${cell}`:cell;
const decimal=(cents:string)=>{const value=BigInt(cents),absolute=value<BigInt(0)?-value:value;return `${value<BigInt(0)?'-':''}${absolute/BigInt(100)}.${(absolute%BigInt(100)).toString().padStart(2,'0')}`;};

/** The download entry point validates the record, scope and observation times. */
export function buildCloseEvidenceCsv(saved:CloseEvidence,readAt:string,exportedAt:string,kind:CloseEvidenceCsvKind):string{
  const contextHeaders=['Close ID','Close kind','Year ID','Period ID','Sequence','Close status observed at read','Read completed at ISO','Download requested at ISO'];
  const context:CsvCell[]=[saved.id,saved.kind,saved.yearId,saved.periodId,saved.sequence,saved.status,readAt,exportedAt];
  const csv=(headers:string[],rows:CsvCell[][])=>buildCsv([...contextHeaders,...headers],rows.map(row=>[...context,...row].map(protect)));
  if(kind==='record-csv'){
    const fields:Array<[string,'SAVED_RECORD'|'CAPTURED_AT_CLOSE'|'OBSERVED_AT_READ',string|boolean|null]>=[
      ['Year name','OBSERVED_AT_READ',saved.yearName],['Period name','OBSERVED_AT_READ',saved.periodName],['Calendar status','OBSERVED_AT_READ',saved.calendarStatus],
      ['Calendar starts on ISO','OBSERVED_AT_READ',saved.startsOn],['Calendar ends on ISO','OBSERVED_AT_READ',saved.endsOn],
      ['Current close','OBSERVED_AT_READ',saved.current],['Later close exists','OBSERVED_AT_READ',saved.laterCloseExists],['Reconciliation status','OBSERVED_AT_READ',saved.reconciliationStatus],
      ['Closed by','SAVED_RECORD',saved.closedBy],['Closed at ISO','SAVED_RECORD',saved.closedAt],['Close reason','SAVED_RECORD',saved.closeReason],
      ['Invalidated by','SAVED_RECORD',saved.invalidatedBy],['Invalidated at ISO','SAVED_RECORD',saved.invalidatedAt],['Invalidation reason','SAVED_RECORD',saved.invalidationReason],
      ['Control totals JSON','CAPTURED_AT_CLOSE',JSON.stringify(saved.controlTotals)],
    ];
    return csv(['Field','Value provenance','Value state','Value'],fields.map(([field,provenance,value])=>[field,provenance,value===null?'NOT_RECORDED':value===''?'EMPTY_TEXT':'RECORDED',value===null?null:String(value)]));
  }
  if(kind==='links-csv'){
    const rows:CsvCell[][]=saved.kind==='year'?[['NOT_ASSESSED',null,null,null,null,'Child-period reconciliation links are not assessed by this year-close inspection.']]
      :saved.linkedReconciliations.length?saved.linkedReconciliations.map(row=>['LINK_OBSERVED',row.id,row.source,row.currency,row.status,'Link and lifecycle status observed at read; not an immutable capture at close.'])
      :[['NO_CURRENT_LINKS',null,null,null,null,'No reconciliation currently links to this close ID. This does not establish that no historical sign-off occurred.']];
    return csv(['Link coverage state','Reconciliation ID','Source','Currency','Reconciliation status observed at read','Coverage explanation'],rows);
  }
  if(kind!=='totals-csv')throw new Error('Unknown close evidence CSV.');
  const summary=closeControlSummary(saved),basis=typeof saved.controlTotals.basis==='string'?saved.controlTotals.basis:null;
  const raw=JSON.stringify(saved.controlTotals);
  const rows:CsvCell[][]=summary.kind==='source'?(summary.rows.length?summary.rows.map(row=>[
    'CAPTURED_SOURCE_CURRENCY',basis,row.currency,row.lineCount,row.subtotalCents,decimal(row.subtotalCents),row.taxCents,decimal(row.taxCents),row.totalCents,decimal(row.totalCents),null,null,raw,
  ]):[['NO_CAPTURED_CURRENCY_ROWS',basis,null,null,null,null,null,null,null,null,null,null,raw]])
    :summary.kind==='year'?[['CAPTURED_YEAR_COUNTS',basis,null,null,null,null,null,null,null,null,summary.periodCount,summary.closeCount,raw]]
    :[['UNRECOGNISED_BASIS',basis,null,null,null,null,null,null,null,null,null,null,raw]];
  return csv(['Captured totals state','Saved basis','Currency','Source line count','Exclusive cents','Exclusive amount','Tax cents','Tax amount','Inclusive cents','Inclusive amount','Financial period count at close','Current period close count at close','Complete saved control totals JSON'],rows);
}
