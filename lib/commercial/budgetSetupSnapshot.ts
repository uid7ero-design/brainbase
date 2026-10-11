export type Dimension={id:string;code:string;active:boolean};
export type Year={id:string;name:string;status:string;periods:{id:string;name:string;starts_on?:string;ends_on?:string}[]};
export type Version={budget_id:string;version_id:string;name:string;financial_year_id:string;currency:string;tax_basis:string;periodisation_mode:string;version_number:number;status:string;can_edit_settings?:boolean;lines:{id:string;budget_account_id:string;cost_centre_id:string;annual_budget_cents:string}[];allocations:{budget_line_id:string;financial_period_id:string;amount_cents:string}[];mappings:{cost_centre_id:string;budget_account_id:string}[]};

export type BudgetSetupSnapshot={versions:Version[];years:Year[];accounts:Dimension[];centres:Dimension[]};
type Row=Record<string,unknown>;
function object(value:unknown):value is Row{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function strings(row:Row,keys:string[]){return keys.every(key=>typeof row[key]==='string'&&row[key]!=='');}
function collection(value:unknown,check:(row:unknown)=>boolean):value is unknown[]{return Array.isArray(value)&&value.every(check);}
function dimension(value:unknown){return object(value)&&strings(value,['id','code'])&&typeof value.active==='boolean';}
function period(value:unknown){return object(value)&&strings(value,['id','name'])&&['starts_on','ends_on'].every(key=>value[key]===undefined||typeof value[key]==='string');}
function year(value:unknown){return object(value)&&strings(value,['id','name','status'])&&collection(value.periods,period);}
function amount(value:unknown){return typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);}
function line(value:unknown){return object(value)&&strings(value,['id','budget_account_id','cost_centre_id'])&&amount(value.annual_budget_cents);}
function allocation(value:unknown){return object(value)&&strings(value,['budget_line_id','financial_period_id'])&&amount(value.amount_cents);}
function mapping(value:unknown){return object(value)&&strings(value,['cost_centre_id','budget_account_id']);}
function version(value:unknown){
  return object(value)&&strings(value,['budget_id','version_id','name','financial_year_id','currency','tax_basis','periodisation_mode','status'])
    &&Number.isSafeInteger(value.version_number)&&Number(value.version_number)>0
    &&(value.can_edit_settings===undefined||typeof value.can_edit_settings==='boolean')
    &&collection(value.lines,line)&&collection(value.allocations,allocation)&&collection(value.mappings,mapping);
}
/** Validate the complete read before replacing any saved view. Amounts remain exact strings. */
export function parseBudgetSetupSnapshot(budgets:unknown,calendar:unknown,accounts:unknown,centres:unknown):BudgetSetupSnapshot{
  if(!object(budgets)||!collection(budgets.versions,version)||!object(calendar)||!collection(calendar.years,year)
    ||!object(accounts)||!collection(accounts.records,dimension)||!object(centres)||!collection(centres.records,dimension)){
    throw new Error('The saved Budget view is incomplete. Reload saved Budget before continuing.');
  }
  return {versions:budgets.versions as Version[],years:calendar.years as Year[],accounts:accounts.records as Dimension[],centres:centres.records as Dimension[]};
}
