'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'proposal-manifest.json'), 'utf8'));
for (const file of manifest.files) {
  const bytes = fs.readFileSync(path.join(dir, file.name));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name + ' drift');
}
if (process.argv.includes('--integrity')) {
  console.log(JSON.stringify({ proposalIntegrity: 'PASS', source: manifest.source, files: manifest.files.length }));
  process.exit(0);
}
const YAML = require('C:/Users/check/sideout-native/node_modules/yaml');
const workflow = YAML.parse(fs.readFileSync(path.join(dir, 'ios-simulator-proof.yml'), 'utf8'));
const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(dir, 'auth-town.yaml'), 'utf8'));
assert(flow.every(d => d.errors.length === 0));
const steps = flow[1].toJSON();
const inputs = steps.filter(s => Object.hasOwn(s, 'inputText')).map(s => s.inputText);
assert.deepEqual(inputs, ['San Juan']);
assert.equal(steps.filter(s => s.tapOn === 'Siguiente').length, 1);
assert(!steps.some(s => ['Entrar', 'Crear cuenta', 'Acepto los términos y la privacidad'].includes(s.tapOn)));
assert.equal(workflow.jobs.simulator['runs-on'], 'macos-26');
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
assert.equal(workflow.jobs.simulator.env.SOURCE_SHA, manifest.source);
const shell = fs.readFileSync(path.join(dir, 'run.sh'), 'utf8');
assert(shell.includes('CODE_SIGNING_ALLOWED=NO'));
assert(!/altool|notarytool|app-store-connect|store\/asc|exportArchive/.test(shell));
assert(!steps.some(s => typeof s === 'object' && ('clearState' in s || 'clearKeychain' in s || 'openLink' in s)));
assert(steps.some(s => s.swipe?.from?.text === '¿En qué pueblo?'));
assert(steps.some(s => s.tapOn === 'Cerrar'));
const result = { checkedAt: new Date().toISOString(), mode: 'STATIC PROPOSAL ONLY', files: manifest.files.length,
  source: manifest.source, yaml: 'PASS', scopedInput: inputs, unsignedSimulatorBoundary: 'PASS',
  productWrites: 0, builds: 0, dispatches: 0, deviceOperations: 0, runtimeProof: 'NOT RUN' };
fs.writeFileSync(path.join(dir, 'proposal-static-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
