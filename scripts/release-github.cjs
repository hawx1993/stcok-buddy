#!/usr/bin/env node
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..');
const RELEASE_DIR = join(ROOT, 'release');
const REPO = 'hawx1993/stcok-buddy';
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const TARGETS = new Set(['current', 'all', 'mac-arm64', 'mac-x64', 'win-x64']);
const HOST_MAC_ARCH = process.arch === 'x64' ? 'x64' : 'arm64';

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  if (result.status !== 0) {
    if (options.capture) {
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      if (output) console.error(output);
    }
    fail(`${command} ${args.join(' ')} failed`);
  }

  return options.capture ? (result.stdout || '').trim() : '';
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const options = {
    allowDirty: false,
    draft: true,
    publish: false,
    reuseRelease: false,
    skipBuild: false,
    targets: 'current',
    tag: '',
    notesFile: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (arg === '--draft') {
      options.draft = true;
      options.publish = false;
      continue;
    }
    if (arg === '--publish') {
      options.publish = true;
      options.draft = false;
      continue;
    }
    if (arg === '--reuse-release') {
      options.reuseRelease = true;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--target') {
      options.targets = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--tag') {
      options.tag = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--notes-file') {
      options.notesFile = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: pnpm run release:github -- [options]

Options:
  --tag vX.Y.Z       Release tag. Defaults to package.json version.
  --draft           Create a draft release (default).
  --publish         Create a published release.
  --reuse-release   Upload assets to an existing release instead of creating it.
  --notes-file file Use a custom Markdown release notes file.
  --skip-build      Skip electron-builder and upload existing release/ assets.
  --target target   Build/upload target: current (default), all, mac-arm64, mac-x64, win-x64.
                   Use all only from the matching arch host or with prebuilt native modules.
  --allow-dirty     Allow releasing with uncommitted changes.
  -h, --help        Show this help.
`);
}

function validateReleaseTargets(targets) {
  const values = targets
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean);
  if (!values.length) fail('--target requires at least one value.');
  for (const value of values) {
    if (!TARGETS.has(value)) fail(`Unknown target: ${value}`);
  }
  if (values.includes('all') && values.length > 1) fail('--target all cannot be combined with other targets.');
  return values;
}

function readPackageJson() {
  return require(join(ROOT, 'package.json'));
}

function normalizeTag(tag) {
  const value = tag.trim();
  if (!value) return '';
  return value.startsWith('v') ? value : `v${value}`;
}

function releaseVersionFromTag(tag) {
  return tag.replace(/^v/, '');
}

function validateVersion(version, label) {
  if (!VERSION_PATTERN.test(version)) fail(`${label} must be a semver version, got: ${version}`);
}

function checkCommand(command, hint) {
  const result = spawnSync(command, ['--version'], { cwd: ROOT, stdio: 'ignore' });
  if (result.status !== 0) fail(`${command} not found. ${hint}`);
}

function checkPrerequisites(options) {
  checkCommand('git', 'Install git first.');
  checkCommand('gh', 'Install GitHub CLI: brew install gh');
  checkCommand('pnpm', 'Install pnpm first.');
  run('gh', ['auth', 'status'], { capture: true });

  if (process.platform !== 'darwin') {
    fail('Building macOS DMG/ZIP requires macOS. Please run the one-command release on macOS.');
  }

  if (!options.allowDirty) {
    const status = git(['status', '--porcelain']);
    if (status) fail('Working tree has uncommitted changes. Commit/stash them or pass --allow-dirty.');
  }
}

function tagExists(tag) {
  const result = spawnSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 && result.stdout.includes(`refs/tags/${tag}`);
}

function getLatestTagBefore(tag) {
  const tags = git(['tag', '--list', 'v*', '--sort=-version:refname'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== tag);
  return tags[0] || '';
}

function cleanReleaseDir() {
  if (!existsSync(RELEASE_DIR)) return;
  for (const entry of readdirSync(RELEASE_DIR)) {
    const path = join(RELEASE_DIR, entry);
    if (
      entry.startsWith('StockBuddy-') ||
      entry === 'latest.yml' ||
      entry === 'latest-mac.yml' ||
      entry.endsWith('.blockmap') ||
      entry.endsWith('-unpacked') ||
      entry === 'mac' ||
      entry === 'mac-arm64' ||
      entry === 'win-unpacked'
    ) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

function builderArgsForTarget(target) {
  if (target === 'mac-arm64') return ['--mac', 'dmg', 'zip', '--arm64'];
  if (target === 'mac-x64') return ['--mac', 'dmg', 'zip', '--x64'];
  if (target === 'win-x64') return ['--win', 'nsis', '--x64'];
  if (target === 'all') return ['--mac', 'dmg', 'zip', '--x64', '--arm64', '--win', 'nsis', '--x64'];
  return ['--mac', 'dmg', 'zip', `--${HOST_MAC_ARCH}`];
}

function buildArtifacts(version, targets) {
  log('Building renderer and Electron main process...');
  run('pnpm', ['run', 'build']);

  for (const target of targets) {
    const builderTarget = target === 'current' ? `mac-${HOST_MAC_ARCH}` : target;
    log(`Building release artifacts for ${builderTarget}...`);
    run('npx', [
      'electron-builder',
      '--config',
      'electron-builder.config.cjs',
      ...builderArgsForTarget(target),
      '--publish',
      'never',
    ], { env: { STOCKBUDDY_APP_VERSION: version } });
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'mac' || entry.name === 'mac-arm64' || entry.name === 'win-unpacked') continue;
      entries.push(...listFiles(path));
    } else {
      entries.push(path);
    }
  }
  return entries;
}

function findAssets(targets) {
  const files = listFiles(RELEASE_DIR);
  const assets = files.filter((file) => {
    const name = basename(file);
    return (
      name.startsWith('StockBuddy-') &&
      (name.endsWith('.dmg') || name.endsWith('.zip') || name.endsWith('.exe') || name.endsWith('.blockmap'))
    ) || name === 'latest.yml' || name === 'latest-mac.yml';
  });

  const names = assets.map((asset) => basename(asset));
  const targetValues = targets.includes('current') ? [`mac-${HOST_MAC_ARCH}`] : targets;
  const required = [
    ...(targetValues.includes('all') || targetValues.includes('mac-arm64') ? [
      { label: 'macOS arm64 dmg', test: /^StockBuddy-.+-mac-arm64\.dmg$/ },
      { label: 'macOS arm64 zip', test: /^StockBuddy-.+-mac-arm64\.zip$/ },
    ] : []),
    ...(targetValues.includes('all') || targetValues.includes('mac-x64') ? [
      { label: 'macOS x64 dmg', test: /^StockBuddy-.+-mac-x64\.dmg$/ },
      { label: 'macOS x64 zip', test: /^StockBuddy-.+-mac-x64\.zip$/ },
    ] : []),
    ...(targetValues.includes('all') || targetValues.includes('win-x64') ? [
      { label: 'Windows x64 installer', test: /^StockBuddy-.+-win-x64-setup\.exe$/ },
      { label: 'latest.yml', test: /^latest\.yml$/ },
    ] : []),
    ...(targetValues.includes('all') || targetValues.some((target) => target.startsWith('mac-')) ? [
      { label: 'latest-mac.yml', test: /^latest-mac\.yml$/ },
    ] : []),
  ];

  for (const item of required) {
    if (!names.some((name) => item.test.test(name))) fail(`Missing asset: ${item.label}`);
  }

  return assets.sort((left, right) => basename(left).localeCompare(basename(right)));
}

function platformSummary(targets) {
  const values = targets.includes('current') ? [`mac-${HOST_MAC_ARCH}`] : targets;
  if (values.includes('all')) return 'macOS arm64/x64, Windows x64';
  return values
    .map((target) => {
      if (target === 'mac-arm64') return 'macOS arm64';
      if (target === 'mac-x64') return 'macOS x64';
      if (target === 'win-x64') return 'Windows x64';
      return target;
    })
    .join(', ');
}

function createNotes(options, tag, version, targets) {
  if (options.notesFile) {
    if (!existsSync(join(ROOT, options.notesFile))) fail(`Notes file not found: ${options.notesFile}`);
    return join(ROOT, options.notesFile);
  }

  const latestTag = getLatestTagBefore(tag);
  const notesDir = mkdtempSync(join(tmpdir(), 'stockbuddy-release-'));
  const notesPath = join(notesDir, 'release-notes.md');
  const args = ['scripts/generate-release-notes.cjs', '--repo', REPO, '--to', 'HEAD'];
  if (latestTag) args.push('--from', latestTag);
  const notes = run('node', args, { capture: true });
  const branch = git(['branch', '--show-current']) || 'unknown';
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const footer = [
    '',
    '---',
    '',
    '### 构建信息',
    '',
    `- Release version: \`${version}\``,
    `- Tag: \`${tag}\``,
    `- Branch: \`${branch}\``,
    `- Commit: \`${commit}\``,
    `- Platforms: ${platformSummary(targets)}`,
    `- Release type: ${options.draft ? 'draft' : 'published'}`,
    '',
  ].join('\n');
  writeFileSync(notesPath, `${notes.trimEnd()}\n${footer}`);
  return notesPath;
}

function releaseExists(tag) {
  const result = spawnSync('gh', ['release', 'view', tag], { cwd: ROOT, stdio: 'ignore' });
  return result.status === 0;
}

function createOrReuseRelease(options, tag, version, notesPath) {
  const exists = releaseExists(tag);
  if (exists && !options.reuseRelease) fail(`GitHub release ${tag} already exists. Pass --reuse-release to upload assets to it.`);

  if (exists) {
    log(`Using existing GitHub release ${tag}.`);
    return;
  }

  const args = [
    'release',
    'create',
    tag,
    '--repo',
    REPO,
    '--title',
    `StockBuddy ${version}`,
    '--notes-file',
    notesPath,
    '--target',
    git(['branch', '--show-current']) || 'HEAD',
  ];
  if (options.draft) args.push('--draft');
  run('gh', args);
}

function uploadAssets(tag, assets) {
  log(`Uploading ${assets.length} release assets...`);
  run('gh', ['release', 'upload', tag, '--repo', REPO, ...assets, '--clobber']);
}

function verifyRelease(tag, targets) {
  const raw = run('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'assets,isDraft,url'], { capture: true });
  const release = JSON.parse(raw);
  const names = release.assets.map((asset) => asset.name);
  const targetValues = targets.includes('current') ? [`mac-${HOST_MAC_ARCH}`] : targets;
  if ((targetValues.includes('all') || targetValues.includes('win-x64')) && !names.includes('latest.yml')) fail('GitHub release is missing latest.yml');
  if ((targetValues.includes('all') || targetValues.some((target) => target.startsWith('mac-'))) && !names.includes('latest-mac.yml')) fail('GitHub release is missing latest-mac.yml');
  log(`Release verified: ${release.url}`);
  log(`Draft: ${release.isDraft}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = readPackageJson();
  const version = releaseVersionFromTag(normalizeTag(options.tag || `v${pkg.version}`));
  validateVersion(version, 'Release version');
  const tag = normalizeTag(options.tag || `v${version}`);

  const targets = validateReleaseTargets(options.targets);

  checkPrerequisites(options);
  if (tagExists(tag) && !options.reuseRelease) fail(`Tag ${tag} already exists on origin. Pass --reuse-release only if the GitHub release already exists.`);

  if (!options.skipBuild) {
    cleanReleaseDir();
    buildArtifacts(version, targets);
  }

  const assets = findAssets(targets);
  const notesPath = createNotes(options, tag, version, targets);
  createOrReuseRelease(options, tag, version, notesPath);
  uploadAssets(tag, assets);
  verifyRelease(tag, targets);
}

main();
