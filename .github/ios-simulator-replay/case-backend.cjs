'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const backend = require('../ios-simulator-proof/local-backend.cjs');
const [mode, kind, dir] = process.argv.slice(2);
assert(['town', 'onboarding', 'copy'].includes(kind));
if (mode === 'init') {
  backend.init(dir);
  if (kind === 'copy') {
    const file = path.join(dir, 'local-state.json'), state = JSON.parse(fs.readFileSync(file));
    state.onboarded_at = '2026-10-12T00:00:00.000Z';
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  }
} else if (mode === 'serve') backend.server(dir).listen(8787, '127.0.0.1', () => console.log('Isolated replay case backend ready'));
else if (mode === 'verify') {
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'local-state.json')));
  const rows = fs.readFileSync(path.join(dir, 'local-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(state.wall, false); assert.equal(state.logins, kind === 'town' ? 0 : 1);
  assert.equal(state.completions, kind === 'onboarding' ? 1 : 0);
  if (kind !== 'town') assert(state.onboarded_at);
  assert(!rows.some(r => /push|notify|signup|purchase|functions\/v1/.test(r.pathname) && r.status < 400));
  fs.writeFileSync(path.join(dir, 'local-case-receipt.json'), JSON.stringify({ at: new Date().toISOString(), kind, logins: state.logins, completions: state.completions, seededOnboarded: kind === 'copy', productionRequests: 0, providerOperations: 0, requests: rows.length, refusedRequests: rows.filter(r => r.status >= 400) }, null, 2) + '\n');
} else throw new Error('Unknown case mode');
