const appVersion = process.env.STOCKBUDDY_APP_VERSION || '${version}'

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
  extraMetadata: {
    ...(process.env.STOCKBUDDY_APP_VERSION ? { version: process.env.STOCKBUDDY_APP_VERSION } : {})
  }
}
