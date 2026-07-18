#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const DEFAULT_TO = 'HEAD';

function fail(message) {
  console.error(`[release-notes] ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (output) console.error(output);
    fail(`${command} ${args.join(' ')} failed`);
  }

  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const options = {
    from: '',
    repo: '',
    to: DEFAULT_TO,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--from') {
      options.from = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--to') {
      options.to = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      options.repo = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!options.to) fail('--to requires a git ref.');
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-release-notes.cjs [options]

Options:
  --from ref     Start ref, exclusive. If omitted, uses the full history up to --to.
  --to ref       End ref, inclusive. Defaults to HEAD.
  --repo owner/repo
                Repository slug used for GitHub commit links.
  -h, --help    Show this help.
`);
}

function gitLogRange(options) {
  if (!options.from) return options.to;
  return `${options.from}..${options.to}`;
}

function commitUrl(repo, hash) {
  if (!repo) return `\`${hash.slice(0, 7)}\``;
  return `[[${hash.slice(0, 7)}](https://github.com/${repo}/commit/${hash})]`;
}

function parseCommit(line) {
  const separator = line.indexOf('\t');
  if (separator === -1) return { hash: line, subject: '' };
  return {
    hash: line.slice(0, separator),
    subject: line.slice(separator + 1),
  };
}

function sectionForSubject(subject) {
  if (/^feat(\(.+\))?:/.test(subject)) return 'features';
  if (/^fix(\(.+\))?:/.test(subject)) return 'fixes';
  if (/^(docs|chore|refactor|perf|build|ci|test)(\(.+\))?:/.test(subject)) return 'others';
  return 'others';
}

function formatSubject(subject) {
  return subject.replace(/^[a-z]+(\(.+\))?:\s*/, '').trim() || subject;
}

function renderSection(title, commits, repo) {
  if (!commits.length) return '';
  const lines = commits.map((commit) => `- ${formatSubject(commit.subject)} ${commitUrl(repo, commit.hash)}`);
  return [`## ${title}`, '', ...lines, ''].join('\n');
}

function generateNotes(options) {
  const range = gitLogRange(options);
  const raw = run('git', ['log', '--pretty=format:%H%x09%s', range]);
  const commits = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCommit);

  if (!commits.length) {
    return ['# Release Notes', '', '本次发布暂无可列出的提交。', ''].join('\n');
  }

  const groups = {
    features: [],
    fixes: [],
    others: [],
  };

  for (const commit of commits) {
    groups[sectionForSubject(commit.subject)].push(commit);
  }

  return [
    '# Release Notes',
    '',
    renderSection('新功能', groups.features, options.repo),
    renderSection('问题修复', groups.fixes, options.repo),
    renderSection('其他变更', groups.others, options.repo),
  ].filter(Boolean).join('\n').trimEnd() + '\n';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  process.stdout.write(generateNotes(options));
}

main();
