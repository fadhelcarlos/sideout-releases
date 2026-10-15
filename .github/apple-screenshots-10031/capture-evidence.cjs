'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict'),http=require('node:http');
const manifest=require('./manifest.json');
const names=['01-inicio','02-torneos','03-torneito','04-ranking','05-canchas','06-perfil','07-mesa'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const save=(dir,name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
function png(file){
  const b=fs.readFileSync(file);
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const info={file:path.basename(file),width:b.readUInt32BE(16),height:b.readUInt32BE(20),bitDepth:b[24],colorType:b[25],bytes:b.length,sha256:sha(b)};
  assert.equal(info.width,1320);assert.equal(info.height,2868);
  let transparency=[4,6].includes(info.colorType);
  for(let at=8;at+12<=b.length;){const n=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8);if(type==='tRNS')transparency=true;at+=n+12;}
  return {...info,hasAlphaOrTransparency:transparency};
}
function extract(archive,destination){
  const entries=cp.execFileSync('unzip',['-Z','-1',archive],{encoding:'utf8'}).trim().split('\n');
  assert(entries.length && entries.every(n=>!n.startsWith('/')&&!n.includes('\\')&&!n.split('/').includes('..')&&!/^[a-z]:/i.test(n)),'Unsafe archive path');
  fs.mkdirSync(destination,{recursive:true});cp.execFileSync('unzip',['-q',archive,'-d',destination]);
}
function retrieve(dir){
  assert.equal(process.env.SOURCE_SHA,manifest.source);
  const id=process.env.APP_ARTIFACT_ID;assert(/^\d+$/.test(id));
  const api=p=>JSON.parse(cp.execFileSync('gh',['api',p],{encoding:'utf8'}));
  const artifact=api(`repos/${manifest.repository}/actions/artifacts/${id}`);
  const run=api(`repos/${manifest.repository}/actions/runs/${artifact.workflow_run.id}`);
  assert.equal(artifact.expired,false);assert.equal(run.conclusion,'success');
  assert.equal(run.head_branch,'codex/apple-native-screenshots-10031');
  assert.equal(run.id,38708886820);assert.equal(run.head_sha,'c4634c8c5c30abd885ded017553a08b534857cda');
  assert.equal(run.path,'.github/workflows/ios-simulator-proof.yml');
  assert.equal(artifact.workflow_run.head_sha,run.head_sha);
  assert.equal(artifact.name,`apple-screenshots-app-10031-${run.id}`);
  const bytes=cp.execFileSync('gh',['api',`repos/${manifest.repository}/actions/artifacts/${id}/zip`],{maxBuffer:300*1024*1024});
  assert.equal(artifact.digest,'sha256:'+sha(bytes));
  const archive=path.join(dir,'source-artifact.zip');fs.writeFileSync(archive,bytes);
  const inherited=path.join(dir,'inherited');extract(archive,inherited);
  assert.equal(fs.readFileSync(path.join(inherited,'source-commit.txt'),'utf8').trim(),manifest.source);
  assert.equal(fs.readFileSync(path.join(inherited,'proof-assets-commit.txt'),'utf8').trim(),run.head_sha);
  const app=read(path.join(inherited,'simulator-app.json'));
  for(const [key,value] of Object.entries(manifest.app))assert.equal(app[key],value,key);
  assert.equal(app.source,manifest.source);assert.deepEqual(app.platforms,['iPhoneSimulator']);
  assert.equal(app.distributionArtifact,false);assert.equal(app.localBackend,true);
  const source=read(path.join(inherited,'source-manifest.json'));assert.equal(source.sourceTree,manifest.sourceTree);
  const appZip=path.join(inherited,'simulator-app.zip');
  assert.equal(fs.readFileSync(appZip+'.sha256','utf8').trim().split(/\s+/)[0],sha(fs.readFileSync(appZip)));
  extract(appZip,path.join(dir,'app'));
  save(dir,'retrieval.json',{observedAt:new Date().toISOString(),artifactId:artifact.id,artifactSha256:sha(bytes),buildRun:run.id,buildRunner:run.head_sha,source:manifest.source,sourceTree:manifest.sourceTree,appArchiveSha256:sha(fs.readFileSync(appZip)),app});
}
function select(dir){
  const inventory=read(path.join(dir,'simulator-inventory.json'));
  const device=inventory.devicetypes.find(d=>d.identifier===manifest.simulator.deviceType);assert(device);
  const runtimes=inventory.runtimes.filter(r=>r.isAvailable&&r.identifier.includes('.iOS-')&&Number(r.version.split('.')[0])>=26);
  runtimes.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));assert(runtimes.length);
  const runtime=runtimes[0];
  save(dir,'simulator-selection.json',{observedAt:new Date().toISOString(),runtime:runtime.identifier,version:runtime.version,build:runtime.buildversion,deviceType:device.identifier,deviceName:device.name,pixels:manifest.simulator.pixels});
}
function verifyApp(dir){
  const expected=read(path.join(dir,'retrieval.json')).app;
  const actual=read(path.join(dir,'simulator-app.json'));
  for(const key of ['source','bundleId','version','build','backend','platforms','executableSha256','jsBundleSha256','distributionArtifact','localBackend'])assert.deepEqual(actual[key],expected[key],key);
  console.log('EXTRACTED_NATIVE_APP_HASHES_VERIFIED');
}
function serve(dir){
  const id=fs.readFileSync(path.join(dir,'simulator-id.txt'),'utf8').trim();assert(/^[a-f0-9-]{36}$/i.test(id));
  const out=path.join(dir,'screenshots');fs.mkdirSync(out,{recursive:true});
  let index=0;
  const server=http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){res.end('ready');return;}
    if(req.method!=='POST'||req.url!=='/capture'){res.writeHead(404);res.end();return;}
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>512)req.destroy();});
    req.on('end',()=>{try{
      const name=JSON.parse(body).name;assert.equal(name,names[index],'Screenshots must be captured once in required order');
      const file=path.join(out,name+'.png');assert(!fs.existsSync(file));
      const command=['simctl','io',id,'screenshot','--type=png',file];
      cp.execFileSync('xcrun',command,{timeout:15000});
      const data={...png(file),capturedAt:new Date().toISOString(),simulatorId:id,method:'xcrun simctl io screenshot',command,postProcessing:false};
      fs.appendFileSync(path.join(dir,'captures.jsonl'),JSON.stringify(data)+'\n');
      index++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error.message)}));}});
  });
  server.listen(8788,'127.0.0.1',()=>console.log('SIMULATOR_CAPTURE_BROKER_READY'));
}
function finish(dir){
  const records=fs.readFileSync(path.join(dir,'captures.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(x=>x.file),names.map(x=>x+'.png'));
  assert.deepEqual(fs.readdirSync(path.join(dir,'screenshots')).sort(),names.map(x=>x+'.png'));
  for(const record of records){const now=png(path.join(dir,'screenshots',record.file));for(const k of Object.keys(now))assert.deepEqual(now[k],record[k]);}
  const retrieval=read(path.join(dir,'retrieval.json'));
  save(dir,'screenshot-manifest.json',{observedAt:new Date().toISOString(),source:manifest.source,sourceTree:manifest.sourceTree,version:'1.0.28',build:'10031',bundleId:manifest.app.bundleId,run:process.env.GITHUB_RUN_ID,runner:process.env.GITHUB_SHA,retrieval,simulator:read(path.join(dir,'simulator-selection.json')),xcode:fs.readFileSync(path.join(dir,'xcode-version.txt'),'utf8').trim(),screenshots:records,manualVisualReview:'pending',postProcessing:false,scope:'Actual native iOS Simulator, synthetic loopback backend; no product code changes or App Store submission'});
  assert(records.every(x=>!x.hasAlphaOrTransparency),'Raw PNG alpha detected. Preserve originals; report before conversion.');
  console.log('SEVEN_NATIVE_PNGS_VERIFIED');
}
if(require.main===module){const [mode,dir]=process.argv.slice(2);({retrieve,select,verifyApp,serve,finish})[mode](path.resolve(dir));}
module.exports={png,names};
