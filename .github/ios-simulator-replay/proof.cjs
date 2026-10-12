'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process'), assert = require('node:assert/strict');
const m = require('./manifest.json');
const [mode, dir, appPath] = process.argv.slice(2);
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (mode === 'select') {
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'simulator-inventory.json')));
  const runtime = all.runtimes.find(r => r.identifier === m.simulator.runtime && r.isAvailable);
  const deviceType = all.devicetypes.find(d => d.identifier === m.simulator.deviceType);
  assert(runtime && deviceType, 'Required retained-app runtime/device unavailable; no replacement or rebuild');
  assert.equal(runtime.version, m.simulator.version); assert.equal(runtime.buildversion, m.simulator.build);
  save('simulator-selection.json', { at: new Date().toISOString(), runtime: { identifier: runtime.identifier, version: runtime.version, buildversion: runtime.buildversion }, deviceType: { identifier: deviceType.identifier, name: deviceType.name } });
} else if (mode === 'app') {
  const app = JSON.parse(fs.readFileSync(path.join(dir, 'simulator-app.json')));
  for (const key of ['bundleId', 'version', 'build', 'source', 'backend', 'executableSha256', 'jsBundleSha256']) assert.equal(app[key], m.app[key], key);
  assert.deepEqual(app.platforms, ['iPhoneSimulator']);
  const info = JSON.parse(cp.execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Info.plist')], { encoding: 'utf8' }));
  const architectures = cp.execFileSync('lipo', ['-archs', path.join(appPath, info.CFBundleExecutable)], { encoding: 'utf8' }).trim().split(/\s+/);
  assert(architectures.includes(process.arch === 'arm64' ? 'arm64' : 'x86_64'));
  save('cached-app-verification.json', { at: new Date().toISOString(), ...app, architectures, hostArchitecture: process.arch, appArchiveSha256: m.app.archiveSha256, nativeBuilds: 0 });
} else if (mode === 'finish') {
  const cases = ['town', 'onboarding', 'copy'].map(kind => {
    const folder = path.join(dir, kind), images = [];
    const collect = relative => {
      for (const item of fs.readdirSync(path.join(folder, relative), { withFileTypes: true })) {
        const name = path.posix.join(relative, item.name);
        if (item.isDirectory()) collect(name);
        else if (item.name.endsWith('.png')) images.push({ name, sha256: sha(path.join(folder, name)) });
      }
    };
    collect('');
    return { kind, exitCode: Number(fs.readFileSync(path.join(folder, 'exit-code.txt'), 'utf8')), simulatorId: fs.existsSync(path.join(folder, 'simulator-id.txt')) ? fs.readFileSync(path.join(folder, 'simulator-id.txt'), 'utf8').trim() : null, screenshots: images };
  });
  save('replay-result.json', { at: new Date().toISOString(), run: process.env.GITHUB_RUN_ID, replayRunner: process.env.GITHUB_SHA, sourceRun: m.sourceRun, sourceRunner: m.sourceRunner, source: m.source, sourceAppArchiveSha256: m.app.archiveSha256, nativeBuilds: 0, independentFreshSimulators: true, wallReplayed: false, localBackend: true, distributionArtifact: false, cases, manualRenderGate: 'PENDING: parent must inspect town selection/dismissal, unsupported onboarding completion and actual native Copy target with exact clipboard receipt.', excludes: ['physical iPhone', 'App Store IPA execution', 'production authentication', 'push delivery', 'purchases', 'Instagram', 'Threads'] });
  if (cases.some(c => c.exitCode !== 0)) process.exitCode = 1;
} else throw new Error('Unknown proof action');
