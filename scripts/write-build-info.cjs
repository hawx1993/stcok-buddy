const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

mkdirSync('build', { recursive: true });
writeFileSync('build/commit-hash.txt', `${commit}\n`);
