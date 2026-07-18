const appVersion = process.env.STOCKBUDDY_APP_VERSION || '${version}'
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = {
  appId: 'com.stocksense.desktop',
  productName: 'StockBuddy',
  asar: true,
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json'
  ],
  extraResources: [
    {
      from: 'public/icons/icon.svg',
      to: 'icons/icon.svg'
    },
    {
      from: 'build/commit-hash.txt',
      to: 'commit-hash.txt'
    },
    {
      from: 'build/telemetry.json',
      to: 'telemetry.json'
    },
    {
      from: 'public/store',
      to: 'public/store'
    }
  ],
  publish: [
    {
      provider: 'github',
      owner: 'hawx1993',
      repo: 'stcok-buddy'
    }
  ],
  artifactName: `StockBuddy-${appVersion}-\${os}-\${arch}.\${ext}`,
  mac: {
    category: 'public.app-category.finance',
    icon: 'build/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    artifactName: `StockBuddy-${appVersion}-mac-\${arch}.\${ext}`
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: `StockBuddy-${appVersion}-win-\${arch}.\${ext}`
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: `StockBuddy-${appVersion}-win-\${arch}-setup.\${ext}`
  },
  dmg: {
    artifactName: `StockBuddy-${appVersion}-mac-\${arch}.\${ext}`,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ]
  },
  afterPack: async (context) => {
    // Fix two code-signing issues on macOS with ad-hoc signing:
    // 1. Electron ships frameworks with linker-signed ad-hoc (Sealed Resources=none);
    //    macOS 26 / Apple Silicon requires sealed resources → --deep re-sign fixes this.
    // 2. Default ad-hoc designated requirement is cdhash (unique per build);
    //    ShipIt requires stable requirement across versions for auto-update →
    //    override with identifier-based requirement.
    // afterPack runs BEFORE electron-builder's signing. If a Developer ID is
    // available, electron-builder will sign over this with proper credentials.
    // If not, electron-builder skips already-signed components, keeping our fix.
    if (context.electronPlatformName !== 'darwin') return;
    const appBundle = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
    );
    const entitlements = path.join(__dirname, 'build', 'entitlements.mac.plist');
    const reqFile = path.join(__dirname, 'build', 'codesign-req.txt');
    console.log('  • Re-signing for macOS (linker-signed fix + stable designated requirement)…');
    try {
      // Step 1: --deep fixes all nested linker-signed framework signatures
      execFileSync('codesign', [
        '--force', '--deep', '--sign', '-',
        '--options', 'runtime',
        '--entitlements', entitlements,
        appBundle,
      ], { stdio: 'inherit' });
      // Step 2: overwrite designated requirement from cdhash to identifier
      // so ShipIt auto-update validation works across builds
      execFileSync('codesign', [
        '--force', '--sign', '-',
        '--options', 'runtime',
        '--entitlements', entitlements,
        '-r', reqFile,
        appBundle,
      ], { stdio: 'inherit' });
      console.log('  • macOS re-signing completed');
    } catch (err) {
      console.error('  • Re-sign warning:', err.message);
    }
  },
  extraMetadata: {
    ...(process.env.STOCKBUDDY_APP_VERSION ? { version: process.env.STOCKBUDDY_APP_VERSION } : {})
  }
}
