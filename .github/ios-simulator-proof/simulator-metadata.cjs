'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const [mode, input, out] = process.argv.slice(2);
const save = (dir, name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (mode === 'select') {
  const inventory = JSON.parse(fs.readFileSync(path.join(input, 'simulator-inventory.json'), 'utf8'));
  const runtime = inventory.runtimes.filter(r => r.isAvailable && /^iOS 26(?:\.|$)/.test(r.name))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  const deviceType = inventory.devicetypes.find(d => d.identifier === 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro');
  assert(runtime, 'No available iOS 26 runtime; inspect saved inventory. No download or substitute is automatic.');
  assert(deviceType, 'Required iPhone 16 Pro Simulator definition is absent.');
  save(input, 'simulator-selection.json', { observedAt: new Date().toISOString(), runtime, deviceType });
} else if (mode === 'config') {
  const config = JSON.parse(fs.readFileSync(input, 'utf8'));
  assert.equal(config.version, '1.0.28');
  assert.equal(String(config.ios.buildNumber), '10028');
  assert.equal(config.ios.bundleIdentifier, 'com.sideoutpr.app');
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL, 'https://omdgfdbtymslljrrsiea.supabase.co');
  assert.equal(process.env.EXPO_PUBLIC_ORIGIN, 'https://sideoutpr.com');
  save(out, 'config-boundary.json', { version: config.version, build: String(config.ios.buildNumber), bundleId: config.ios.bundleIdentifier,
    backend: process.env.EXPO_PUBLIC_SUPABASE_URL, origin: process.env.EXPO_PUBLIC_ORIGIN,
    scope: 'Unsigned Release Simulator; no distribution credential, upload, version stamp or identity input.' });
} else if (mode === 'app') {
  const info = JSON.parse(cp.execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(input, 'Info.plist')], { encoding: 'utf8' }));
  assert.equal(info.CFBundleIdentifier, 'com.sideoutpr.app');
  assert.equal(info.CFBundleShortVersionString, '1.0.28');
  assert.equal(String(info.CFBundleVersion), '10028');
  assert(info.CFBundleSupportedPlatforms.includes('iPhoneSimulator'));
  const bundle = path.join(input, 'main.jsbundle');
  assert(fs.existsSync(bundle), 'Release must contain its JS bundle; no Metro substitute.');
  const bytes = fs.readFileSync(bundle);
  assert(bytes.includes(Buffer.from('omdgfdbtymslljrrsiea.supabase.co')), 'Production backend must be embedded.');
  for (const forbidden of ['localhost:8787', '127.0.0.1:8787', '__audit', 'startup-storage-fault-prelude']) {
    assert(!bytes.includes(Buffer.from(forbidden)), `Audit runtime marker found: ${forbidden}`);
  }
  save(out, 'simulator-app.json', { observedAt: new Date().toISOString(), bundleId: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString, build: String(info.CFBundleVersion), platforms: info.CFBundleSupportedPlatforms,
    executableSha256: sha(path.join(input, info.CFBundleExecutable)), jsBundleSha256: sha(bundle),
    source: process.env.SOURCE_SHA, distributionArtifact: false });
} else if (mode === 'finish') {
  const png = fs.readFileSync(path.join(input, 'final-screen.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  const names = fs.readdirSync(input).filter(n => n.endsWith('.png')).sort();
  save(input, 'execution-receipt.json', { observedAt: new Date().toISOString(), source: process.env.SOURCE_SHA,
    simulatorId: process.env.SIM_ID, flowExitCode: Number(process.env.FLOW_EXIT), theme: 'dark',
    screenshotPixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    screenshots: names.map(name => ({ name, sha256: sha(path.join(input, name)) })),
    assertions: 'Maestro assertions are in junit.xml and command log; screenshots still require actual visual inspection.',
    manualRenderGate: 'PENDING: inspect player/Business fields, full-width/bottom town sheet, search, selected parent and gesture/close captures.',
    excludes: ['physical iPhone', 'App Store IPA execution', 'authenticated state', 'signup', 'push', 'purchases', 'universal links'] });
} else throw new Error('Unknown metadata mode');
