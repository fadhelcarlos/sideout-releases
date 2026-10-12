'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const [mode, input, out] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'proposal-manifest.json'), 'utf8'));
const { LOCAL_URL, KEY } = require('./local-backend.cjs');
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
  assert.equal(config.version, manifest.version);
  assert.equal(String(config.ios.buildNumber), manifest.build);
  assert.equal(config.ios.bundleIdentifier, 'com.sideoutpr.app');
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL, LOCAL_URL);
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_KEY, KEY);
  assert.equal(process.env.EXPO_PUBLIC_ORIGIN, 'https://sideoutpr.com');
  save(out, 'config-boundary.json', { version: config.version, build: String(config.ios.buildNumber), bundleId: config.ios.bundleIdentifier,
    backend: process.env.EXPO_PUBLIC_SUPABASE_URL, origin: process.env.EXPO_PUBLIC_ORIGIN,
    localBackend: true, distributionArtifact: false,
    scope: 'Unsigned local-backend Simulator; synthetic identity only, no production auth or distribution credential.' });
} else if (mode === 'ats') {
  const info = JSON.parse(cp.execFileSync('plutil', ['-convert', 'json', '-o', '-', input], { encoding: 'utf8' }));
  assert.equal(info.NSAppTransportSecurity?.NSAllowsLocalNetworking, true);
  assert.equal(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads, false);
  save(out, 'generated-ats.json', { observedAt: new Date().toISOString(), infoPlistSha256: sha(input),
    ats: info.NSAppTransportSecurity, source: 'Standard Expo prebuild; no plist mutation' });
} else if (mode === 'app') {
  const info = JSON.parse(cp.execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(input, 'Info.plist')], { encoding: 'utf8' }));
  assert.equal(info.CFBundleIdentifier, 'com.sideoutpr.app');
  assert.equal(info.CFBundleShortVersionString, manifest.version);
  assert.equal(String(info.CFBundleVersion), manifest.build);
  assert(info.CFBundleSupportedPlatforms.includes('iPhoneSimulator'));
  assert.equal(info.NSAppTransportSecurity?.NSAllowsLocalNetworking, true);
  assert.equal(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads, false);
  const bundle = path.join(input, 'main.jsbundle');
  assert(fs.existsSync(bundle), 'Release must contain its JS bundle; no Metro substitute.');
  const bytes = fs.readFileSync(bundle);
  assert(bytes.includes(Buffer.from(LOCAL_URL)), 'Only the runner-local backend must be embedded.');
  assert(bytes.includes(Buffer.from(KEY)), 'Synthetic public key must be embedded.');
  for (const forbidden of ['omdgfdbtymslljrrsiea.supabase.co', 'sb_publishable_FofnCfjBG9WxxBeDpBMfOQ_5SdDwGch', '__audit', 'startup-storage-fault-prelude']) {
    assert(!bytes.includes(Buffer.from(forbidden)), `Audit runtime marker found: ${forbidden}`);
  }
  save(out, 'simulator-app.json', { observedAt: new Date().toISOString(), bundleId: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString, build: String(info.CFBundleVersion), platforms: info.CFBundleSupportedPlatforms,
    executableSha256: sha(path.join(input, info.CFBundleExecutable)), jsBundleSha256: sha(bundle),
    source: process.env.SOURCE_SHA, distributionArtifact: false, localBackend: true, backend: LOCAL_URL,
    ats: info.NSAppTransportSecurity });
} else if (mode === 'clipboard') {
  const value = fs.readFileSync(input, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  const expected = 'Juega conmigo en sideout\n\nhttps://sideoutpr.com';
  assert.equal(value, expected, 'The real iOS Copy target must preserve the entire shared message and URL');
  save(out, 'share-copy-receipt.json', { observedAt: new Date().toISOString(), target: 'iOS system share Copy',
    text: value, sha256: sha(input), exactExpectedMessage: true,
    excludes: ['Instagram', 'Threads', 'message delivery', 'physical iPhone'] });
} else if (mode === 'finish') {
  const png = fs.readFileSync(path.join(input, 'final-screen.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  const names = [];
  const collect = (relative = '') => {
    for (const entry of fs.readdirSync(path.join(input, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) collect(name);
      else if (entry.isFile() && entry.name.endsWith('.png')) names.push(name);
    }
  };
  collect();
  names.sort();
  save(input, 'execution-receipt.json', { observedAt: new Date().toISOString(), source: process.env.SOURCE_SHA,
    simulatorId: process.env.SIM_ID, flowExitCode: Number(process.env.FLOW_EXIT), theme: 'dark',
    screenshotPixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    screenshots: names.map(name => ({ name, sha256: sha(path.join(input, name)) })),
    assertions: 'Maestro assertions are in junit.xml and command log; screenshots still require actual visual inspection.',
    localBackend: true, distributionArtifact: false,
    manualRenderGate: 'PENDING: inspect auth/town, unsupported onboarding, native Copy target and iOS wall/browser captures.',
    excludes: ['physical iPhone', 'App Store IPA execution', 'production authenticated state', 'signup', 'push delivery', 'purchases', 'universal links', 'Instagram', 'Threads'] });
} else throw new Error('Unknown metadata mode');
