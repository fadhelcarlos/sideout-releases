'use strict';
// Runs only on the proof runner; never points at the sideout checkout or retained app.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const [mode, source, evidence, products] = process.argv.slice(2);
const ref = 'c8c361be1cc89b2e742f185466a302a22778be6b';
const relative = 'maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/ViewHierarchyHandler.swift';
const beforeSha = 'cc55cb4523b9208a6852f85851fef57355b105114bf202932d3d0a2f87ac76a8';
const before = '        let safariWebViewHierarchy = logger.measure(message: "Fetch Safari WebView hierarchy") {\n            getSafariWebViewHierarchy()\n        }';
const after = '        // Native-only proof driver; the accepted Safari flow is excluded.\n        NSLog("sideout-native-proof: Safari hierarchy disabled")\n        let safariWebViewHierarchy: AXElement? = nil';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const file = path.join(source, relative);
assert.equal(cp.execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), ref);
const packageFile = path.join(source, 'maestro-ios-xctest-runner/maestro-driver-ios.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
assert.equal(sha(fs.readFileSync(packageFile)), '0769349aecc7f83fb2729fba68c9583c3a51b324a0225485865dc064ccab48b4');
if (mode === 'prepare') {
  assert.equal(cp.execFileSync('git', ['-C', source, 'status', '--porcelain'], {encoding: 'utf8'}).trim(), '');
  const original = fs.readFileSync(file);
  assert.equal(sha(original), beforeSha);
  assert.equal(original.toString().split(before).length, 2);
  const candidate = Buffer.from(original.toString().replace(before, after));
  assert.equal(sha(Buffer.from(candidate.toString().replace(after, before))), beforeSha, 'Exact inverse before mutation');
  fs.writeFileSync(path.join(evidence, 'native-driver-original.swift'), original, {flag: 'wx'});
  fs.writeFileSync(path.join(evidence, 'native-driver-patched.swift'), candidate, {flag: 'wx'});
  fs.writeFileSync(file + '.tmp', candidate, {flag: 'wx'}); fs.renameSync(file + '.tmp', file);
  fs.writeFileSync(path.join(evidence, 'native-driver-source.json'), JSON.stringify({
    at: new Date().toISOString(), upstream: 'mobile-dev-inc/Maestro', tag: 'cli-2.11.0', commit: ref,
    file: relative, beforeSha256: beforeSha, afterSha256: sha(candidate),
    override: 'USE_XCODE_TEST_RUNNER=1 plus --driver-host-port; manually owned XCTest process',
    productChanges: 0, sideoutBuilds: 0,
  }, null, 2) + '\n', {flag: 'wx'});
} else if (mode === 'capture') {
  const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'native-driver-source.json')));
  assert.equal(sha(fs.readFileSync(file)), receipt.afterSha256);
  const changed = cp.execFileSync('git', ['-C', source, 'diff', '--name-only'], {encoding: 'utf8'}).trim().split('\n');
  assert.deepEqual(changed, [relative]);
  const files = [];
  const walk = folder => { for (const ent of fs.readdirSync(folder, {withFileTypes: true})) {
    const full = path.join(folder, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.isFile()) files.push({path: path.relative(products, full), bytes: fs.statSync(full).size, sha256: sha(fs.readFileSync(full))});
  }};
  walk(products);
  const configs = files.filter(f => f.path.endsWith('.xctestrun'));
  assert.equal(configs.length, 1, 'Require the single compiled test configuration');
  assert(files.some(f => /maestro-driver-iosUITests-Runner\.app/.test(f.path)));
  fs.writeFileSync(path.join(evidence, 'native-driver-build.json'), JSON.stringify({at: new Date().toISOString(),
    ...receipt, products, xctestrun: configs[0].path, files, simulatorOnly: true, sideoutBuilds: 0,
  }, null, 2) + '\n', {flag: 'wx'});
  fs.writeFileSync(path.join(evidence, 'native-driver-xctestrun.txt'), path.join(products, configs[0].path) + '\n', {flag: 'wx'});
} else if (mode === 'restore') {
  const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'native-driver-source.json')));
  const current = fs.readFileSync(file);
  assert.equal(sha(current), receipt.afterSha256, 'Source drift blocks restoration');
  assert.equal(current.toString().split(after).length, 2);
  const restored = Buffer.from(current.toString().replace(after, before));
  assert.equal(sha(restored), beforeSha, 'Exact inverse must restore original bytes');
  fs.writeFileSync(file + '.tmp', restored, {flag: 'wx'}); fs.renameSync(file + '.tmp', file);
  assert.equal(sha(fs.readFileSync(file)), beforeSha);
  assert.equal(cp.execFileSync('git', ['-C', source, 'diff', '--name-only'], {encoding: 'utf8'}).trim(), '');
  fs.writeFileSync(path.join(evidence, 'native-driver-source-restored.json'), JSON.stringify({at:new Date().toISOString(),commit:ref,
    restoredSha256:beforeSha,expectedCandidateSha256:receipt.afterSha256,exactInverse:true},null,2)+'\n',{flag:'wx'});
} else throw new Error('Unknown driver preparation action');
