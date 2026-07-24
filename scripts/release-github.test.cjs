#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'release-github.cjs');
const {
  assertLatestMacManifestMatchesAssets,
  createMacUpdateFileEntry,
  findMissingReleaseAssets,
  formatMacUpdateManifest,
  orderReleaseAssets,
} = require(SCRIPT);

function writeAsset(dir, name, content) {
  const filePath = join(dir, name);
  writeFileSync(filePath, content);
  return filePath;
}

function main() {
  const directory = mkdtempSync(join(tmpdir(), 'stockbuddy-release-manifest-'));
  try {
    const arm64Zip = writeAsset(directory, 'StockBuddy-1.2.3-mac-arm64.zip', 'arm64 zip');
    const arm64Dmg = writeAsset(directory, 'StockBuddy-1.2.3-mac-arm64.dmg', 'arm64 dmg');
    const x64Zip = writeAsset(directory, 'StockBuddy-1.2.3-mac-x64.zip', 'x64 zip');
    const x64Dmg = writeAsset(directory, 'StockBuddy-1.2.3-mac-x64.dmg', 'x64 dmg');
    const assets = [arm64Zip, arm64Dmg, x64Zip, x64Dmg];
    const manifest = formatMacUpdateManifest('1.2.3', assets.map(createMacUpdateFileEntry));
    const manifestPath = join(directory, 'latest-mac.yml');
    writeFileSync(manifestPath, manifest);

    assert.match(manifest, /StockBuddy-1\.2\.3-mac-arm64\.zip/);
    assert.match(manifest, /StockBuddy-1\.2\.3-mac-x64\.zip/);
    assertLatestMacManifestMatchesAssets(manifestPath, [...assets, manifestPath], ['arm64', 'x64']);

    const orderedAssets = orderReleaseAssets([
      join(directory, 'latest-mac.yml'),
      writeAsset(directory, 'StockBuddy-1.2.3-mac-arm64.zip.blockmap', 'arm64 zip blockmap'),
      arm64Zip,
      arm64Dmg,
      x64Zip,
      x64Dmg,
    ]);
    assert.deepEqual(orderedAssets.map((filePath) => filePath.split('/').pop()), [
      'StockBuddy-1.2.3-mac-arm64.dmg',
      'StockBuddy-1.2.3-mac-arm64.zip',
      'StockBuddy-1.2.3-mac-x64.dmg',
      'StockBuddy-1.2.3-mac-x64.zip',
      'StockBuddy-1.2.3-mac-arm64.zip.blockmap',
      'latest-mac.yml',
    ]);
    assert.deepEqual(
      findMissingReleaseAssets(
        [...assets, manifestPath].map((filePath) => filePath.split('/').pop()),
        [...assets, manifestPath],
      ),
      [],
    );
    assert.deepEqual(
      findMissingReleaseAssets(
        ['StockBuddy-1.2.3-mac-arm64.zip.blockmap', 'latest-mac.yml'],
        [...assets, manifestPath],
      ),
      [
        'StockBuddy-1.2.3-mac-arm64.zip',
        'StockBuddy-1.2.3-mac-arm64.dmg',
        'StockBuddy-1.2.3-mac-x64.zip',
        'StockBuddy-1.2.3-mac-x64.dmg',
      ],
    );

    const invalidManifestPath = join(directory, 'latest-mac-x64-only.yml');
    writeFileSync(invalidManifestPath, formatMacUpdateManifest('1.2.3', [createMacUpdateFileEntry(x64Zip), createMacUpdateFileEntry(x64Dmg)]));
    const invalidCheck = spawnSync(process.execPath, [
      '-e',
      `const release = require(${JSON.stringify(SCRIPT)}); release.assertLatestMacManifestMatchesAssets(${JSON.stringify(invalidManifestPath)}, ${JSON.stringify([x64Zip, x64Dmg, invalidManifestPath])}, ['arm64', 'x64']);`,
    ], { encoding: 'utf8' });
    assert.notEqual(invalidCheck.status, 0, 'x64-only metadata must fail validation for a dual-architecture release');
    assert.match(invalidCheck.stderr, /arm64 ZIP update asset/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

main();
console.log('release-github dual-architecture manifest regression test passed');
