'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const [mode, library, evidence] = process.argv.slice(2);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const matches = fs.readdirSync(library).filter(name => /^maestro-ios-driver.*\.jar$/.test(name));
assert.equal(matches.length, 1, 'Require the single stock Maestro iOS driver JAR');
const source = path.join(library, matches[0]), bytes = fs.readFileSync(source);
const receiptPath = path.join(evidence, 'stock-driver.json');
if (mode === 'preserve') {
  fs.writeFileSync(path.join(evidence, 'stock-maestro-ios-driver.jar'), bytes, {flag: 'wx'});
  fs.writeFileSync(receiptPath, JSON.stringify({at:new Date().toISOString(),source,bytes:bytes.length,sha256:sha(bytes),
    officialCliZipSHA256:'5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a',
    stockModified:false,override:'manual XCTest runner; stock JAR remains byte-identical'},null,2)+'\n',{flag:'wx'});
} else if (mode === 'verify') {
  const r = JSON.parse(fs.readFileSync(receiptPath));
  assert.equal(sha(bytes), r.sha256); assert.equal(sha(fs.readFileSync(path.join(evidence,'stock-maestro-ios-driver.jar'))), r.sha256);
  fs.writeFileSync(path.join(evidence,'stock-driver-preserved.json'),JSON.stringify({at:new Date().toISOString(),sha256:r.sha256,unchanged:true},null,2)+'\n',{flag:'wx'});
} else throw new Error('Unknown stock driver operation');
