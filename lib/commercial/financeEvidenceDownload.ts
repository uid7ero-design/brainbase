export type FinanceEvidenceFile={filename:string;type:string;content:string};

/** Requests a browser save; this cannot certify completion or a file on disk. */
export function requestFinanceEvidenceDownload(file:FinanceEvidenceFile):string{
  if(typeof window==='undefined'||typeof document==='undefined'||!document.body)throw new Error('Browser downloads are unavailable.');
  const link=document.createElement('a');
  const url=URL.createObjectURL(new Blob([file.content],{type:file.type}));
  let cleanup:number|undefined;
  try{
    // Keep the URL alive long enough for the browser to consume the request.
    // The timer survives reader unmounts and retains only the URL, not evidence.
    cleanup=window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
    link.href=url;link.download=file.filename;
    document.body.appendChild(link);
    link.click();
  }catch{
    if(cleanup!==undefined)window.clearTimeout(cleanup);
    URL.revokeObjectURL(url);
    throw new Error('Unable to request the evidence download.');
  }finally{link.remove();}
  return `Download requested: ${file.filename}. Check your browser’s downloads for the file.`;
}
