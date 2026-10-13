'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const m=require('./manifest.json'),mode=process.argv[2],sourceDir=process.argv[3];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert(['integrity','input','source'].includes(mode),'Unknown verification mode');
for(const f of [...m.files,...m.unchangedInputs]) assert.equal(sha(fs.readFileSync(path.resolve(__dirname,f.path))),f.sha256,f.path);
if(mode!=='integrity') {
  assert(/^[a-f0-9]{40}$/.test(m.source||''),'SOURCE_UNBOUND: run the reviewed local bind step before integration/dispatch');
  assert.equal(process.env.SOURCE_SHA,m.source,'Dispatch source does not match the reviewed manifest');
  assert.equal(m.app.source,m.source);
  assert.equal(m.app.version,'1.0.28'); assert.equal(m.app.build,'10030');
  assert(m.sourceBindings?.length>=6,'Missing source blob bindings');
}
if(mode==='source') {
  assert(sourceDir,'Source checkout required');
  const git=(...args)=>cp.execFileSync('git',['-C',sourceDir,...args],{encoding:'utf8'}).trim();
  assert.equal(git('rev-parse','HEAD'),m.source);
  assert.equal(git('status','--porcelain'),'','Source checkout must be clean');
  for(const f of m.sourceBindings) assert.equal(sha(fs.readFileSync(path.join(sourceDir,f.path))),f.sha256,f.path);
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL,m.app.backend);
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_KEY,'sideout-simulator-local-public-key');
  assert.equal(process.env.EXPO_PUBLIC_ORIGIN,'https://sideoutpr.com');
}
console.log(JSON.stringify({mode,integrity:true,sourceBound:Boolean(m.source),source:mode==='integrity'?undefined:m.source}));
