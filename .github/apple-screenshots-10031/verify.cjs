'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const m=require('./manifest.json');
const [mode,sourceDir]=process.argv.slice(2);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(process.env.SOURCE_SHA,m.source);
assert.equal(m.app.version,'1.0.28');assert.equal(m.app.build,'10031');
assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL,m.app.backend);
assert.equal(process.env.EXPO_PUBLIC_SUPABASE_KEY,'sideout-simulator-local-public-key');
if(mode==='source'){
  const git=(...args)=>cp.execFileSync('git',['-C',sourceDir,...args],{encoding:'utf8'}).trim();
  assert.equal(git('rev-parse','HEAD'),m.source);
  assert.equal(git('status','--porcelain'),'');
  assert.equal(git('rev-parse','HEAD^{tree}'),m.sourceTree);
  for(const f of m.sourceBindings)assert.equal(sha(fs.readFileSync(path.join(sourceDir,f.path))),f.sha256,f.path);
}else assert.equal(mode,'input');
console.log('SCREENSHOT_SOURCE_VERIFIED');
