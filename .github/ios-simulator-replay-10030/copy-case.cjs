'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const backend=require('./copy-backend.cjs');
const save=(dir,name,x)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(x,null,2)+'\n');
function clipboard(value,person) {
  const expected=person.name+' en sideout\n\nhttps://sideoutpr.com/p/'+person.handle;
  assert(value.length>0,'OS Copy must produce nonempty text');
  assert.equal(value.replace(/\r\n/g,'\n').replace(/\n$/,''),expected,'Actual iOS Copy must retain the current-run profile name and URL');
  return expected;
}
if(require.main===module){
 const [mode,dir]=process.argv.slice(2);assert(dir);
 if(mode==='init'){
  const run=process.env.GITHUB_RUN_ID;assert(/^\d{8,14}$/.test(run||''));
  backend.init(dir);const file=path.join(dir,'local-state.json'),state=JSON.parse(fs.readFileSync(file));
  state.onboarded_at='2026-10-12T00:00:00.000Z';state.proofRun=run;save(dir,'local-state.json',state);
  const person=backend.proofPerson(state);save(dir,'copy-target.json',{run,person,source:'runner-local synthetic friend; real profile sharing',freshSimulator:true,clipboardSeeded:false});
  const template=fs.readFileSync(path.join(__dirname,'copy.yaml'),'utf8');assert.equal(template.split('__PROOF_NAME__').length,3);
  fs.writeFileSync(path.join(dir,'copy.yaml'),template.replaceAll('__PROOF_NAME__',person.name),{flag:'wx'});
 }else if(mode==='serve')backend.server(dir).listen(8787,'127.0.0.1',()=>console.log('Copy-only local backend ready'));
 else if(mode==='verify'){
  const state=JSON.parse(fs.readFileSync(path.join(dir,'local-state.json'))),rows=fs.readFileSync(path.join(dir,'local-requests.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(state.wall,false);assert.equal(state.logins,1);assert.equal(state.completions,0);assert(state.onboarded_at);
  assert(rows.some(r=>r.pathname==='/rest/v1/rpc/ll_profile'&&r.status===200));
  assert(!rows.some(r=>/push|notify|signup|purchase|functions\/v1/.test(r.pathname)&&r.status<400));
  save(dir,'local-case-receipt.json',{at:new Date().toISOString(),kind:'copy',run:state.proofRun,person:backend.proofPerson(state),logins:state.logins,completions:state.completions,seededOnboarded:true,productionRequests:0,providerOperations:0,requests:rows.length,refusedRequests:rows.filter(r=>r.status>=400)});
 }else if(mode==='clipboard'){
  const target=JSON.parse(fs.readFileSync(path.join(dir,'copy-target.json'))),bytes=fs.readFileSync(path.join(dir,'share-pasteboard.txt'));
  const expected=clipboard(bytes.toString('utf8'),target.person);
  save(dir,'share-copy-receipt.json',{at:new Date().toISOString(),target:'iOS system share Copy',run:target.run,text:expected,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exactExpectedMessage:true,clipboardSeeded:false,excludes:['physical iPhone','message delivery','Instagram','Threads']});
 }else throw Error('Unknown copy case mode');
}
module.exports={clipboard};
