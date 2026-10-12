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
const YAML = require(require.resolve('yaml', { paths: [process.env.SOURCE_DIR || 'C:/Users/check/sideout-native'] }));
const workflow = YAML.parse(fs.readFileSync(path.join(dir, 'ios-simulator-proof.yml'), 'utf8'));
const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(dir, 'auth-town.yaml'), 'utf8'));
assert(flow.every(d => d.errors.length === 0));
const steps = flow[1].toJSON();
const screenshots = steps.filter(s => Object.hasOwn(s, 'takeScreenshot')).map(s => s.takeScreenshot);
assert(screenshots.every(name => typeof name === 'string' && /^\d{2}-[a-z0-9-]+$/.test(name)), 'Screenshot paths must be relative names without traversal');
assert.deepEqual(screenshots, ["00-player-door","01-player-auth-keyboard","02-player-auth-blank","03-business-door","04-business-auth-keyboard","05-business-auth-blank","06-town-full-list","07-town-search-keyboard","08-town-selected","09-town-reopened","10-town-gesture-dismissed","11-town-close-retained"], 'Expected twelve unique screenshot names in flow order');
const inputs = steps.filter(s => Object.hasOwn(s, 'inputText')).map(s => s.inputText);
assert.deepEqual(inputs, ['San J']);
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
const { LOCAL_URL, KEY, HANDLE, PASSWORD } = require('./local-backend.cjs');
assert.equal(manifest.backend, LOCAL_URL);
assert.equal(manifest.distributionArtifact, false);
assert.equal(manifest.version, '1.0.28');
assert(/^\d+$/.test(manifest.build));
assert.equal(workflow.jobs.simulator.env.EXPO_PUBLIC_SUPABASE_URL, LOCAL_URL);
assert.equal(workflow.jobs.simulator.env.EXPO_PUBLIC_SUPABASE_KEY, KEY);
assert.equal(workflow.jobs.simulator.env.EXPO_PUBLIC_ORIGIN, 'https://sideoutpr.com');
const sourceCheckout = workflow.jobs.simulator.steps.find(s => s.with?.repository === 'fadhelcarlos/sideout-native');
assert.equal(sourceCheckout.with.ref, manifest.source);
function parseSteps(name, expectedScreens) {
  const docs = YAML.parseAllDocuments(fs.readFileSync(path.join(dir, name), 'utf8'));
  assert(docs.every(d => d.errors.length === 0), name);
  assert.equal(docs[0].toJSON().appId, 'com.sideoutpr.app');
  const items = docs[1].toJSON();
  const shots = items.filter(s => Object.hasOwn(s, 'takeScreenshot')).map(s => s.takeScreenshot);
  assert(shots.every(s => typeof s === 'string' && /^\d{2}-[a-z0-9-]+$/.test(s)), 'Screenshot paths must be relative names without traversal');
  assert.deepEqual(shots, expectedScreens, 'Expected exact screenshot order');
  assert(!items.some(s => typeof s === 'object' && ('clearState' in s || 'clearKeychain' in s || 'openLink' in s || 'runScript' in s)));
  return items;
}
const onboarding = parseSteps('onboarding-share.yaml', ['12-onboarding-start','13-onboarding-unsupported','14-onboarding-completed',
  '15-share-product-sheet','16-share-ios-targets','17-share-copy-returned']);
assert.deepEqual(onboarding.filter(s => Object.hasOwn(s, 'inputText')).map(s => s.inputText), [HANDLE, PASSWORD]);
assert.equal(onboarding.filter(s => s.tapOn === 'Siguiente').length, 5);
assert(onboarding.some(s => s.tapOn === '.*Avísame cuando me toque.*'));
assert(onboarding.some(s => s.assertVisible === '.*Actívalos en Ajustes del teléfono.*'));
assert(onboarding.some(s => s.tapOn === 'Compartir'));
assert(onboarding.some(s => s.tapOn === '^(Copy|Copiar)$'));
const wall = parseSteps('ios-wall.yaml', ['18-ios-wall-alternatives','18-ios-wall-browser-opening','19-ios-wall-browser-opened']);
assert(!wall.some(s => Object.hasOwn(s, 'inputText')));
assert(wall.some(s => s.extendedWaitUntil?.visible === '^Ya tengo cuenta$'));
const wallHooks = YAML.parseAllDocuments(fs.readFileSync(path.join(dir, 'ios-wall.yaml'), 'utf8'))[0].toJSON().onFlowComplete;
assert.deepEqual(wallHooks, [{ tapOn: { text: '^(Done|OK|Listo)$', optional: true } },
  { assertVisible: 'Abrir sideout en el navegador' }, { takeScreenshot: '20-ios-wall-returned' }]);
assert(wall.some(s => s.assertNotVisible === 'Actualizar'));
assert(wall.some(s => s.tapOn === 'Abrir sideout en el navegador'));
assert(!wall.some(s => s.tapOn === 'Escríbenos'));
assert(shell.includes('simctl pbpaste "$SIM_ID"'));
assert(shell.includes('local-backend.cjs" verify-onboarding'));
assert(shell.includes('trap cleanup_backend EXIT'));
assert(shell.includes('simulator-metadata.cjs" ats'));
const result = { checkedAt: new Date().toISOString(), mode: 'STATIC PROPOSAL ONLY', files: manifest.files.length,
  source: manifest.source, yaml: 'PASS', scopedInput: inputs, unsignedSimulatorBoundary: 'PASS',
  localBackend: LOCAL_URL, distributionArtifact: false, syntheticPlayerInput: true,
  productWrites: 0, builds: 0, dispatches: 0, deviceOperations: 0, runtimeProof: 'NOT RUN' };
fs.writeFileSync(path.join(dir, 'proposal-static-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
