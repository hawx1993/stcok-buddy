const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

mkdirSync('build', { recursive: true });
writeFileSync('build/commit-hash.txt', `${commit}\n`);
writeFileSync('build/telemetry.json', `${JSON.stringify({
  posthogKey: process.env.POSTHOG_API_KEY || process.env.VITE_PUBLIC_POSTHOG_KEY || '',
  posthogHost: process.env.POSTHOG_HOST || process.env.VITE_PUBLIC_POSTHOG_HOST || '',
})}\n`);
