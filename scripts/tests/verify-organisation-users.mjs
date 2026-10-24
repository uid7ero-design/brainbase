// Synthetic-only policy and actual SQL proof. Never accepts a hosted DB URL.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const container='organisation-users-'+randomBytes(6).toString('hex');
const password=randomBytes(20).toString('hex');
const exec=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,...options});
try{
  exec('docker',['run','-d','--name',container,'-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=orgusers','-p','127.0.0.1::5432','postgres:16-alpine']);
  const address=exec('docker',['port',container,'5432/tcp']).trim();
  if(!/^127\.0\.0\.1:\d+$/.test(address))throw Error('Disposable database must use loopback');
  let ready=false;for(let i=0;i<40;i++){try{exec('docker',['exec',container,'pg_isready','-U','postgres','-d','orgusers'],{stdio:'ignore'});ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
  if(!ready)throw Error('Disposable Postgres did not start');
  const url=`postgresql://postgres:${password}@${address}/orgusers`;
  exec(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/containment/organisationUsersRealPostgres.test.ts','tests/containment/organisationUserPolicy.test.ts','tests/containment/organisationUserMiddleware.test.ts','tests/containment/navModel.test.ts'],{
    stdio:'inherit',timeout:120000,env:{...process.env,ORG_USERS_TEST_DATABASE_URL:url,DATABASE_URL:url,DIRECT_URL:url,RESEND_API_KEY:'',SESSION_SECRET:randomBytes(32).toString('hex')},
  });
}finally{try{exec('docker',['rm','-f',container],{stdio:'ignore'});}catch{/* preserve a failed cleanup for operator inspection */}}
