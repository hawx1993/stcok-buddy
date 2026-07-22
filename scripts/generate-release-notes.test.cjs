#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/generate-release-notes.cjs');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_NOTES_ROOT: cwd },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function writePackage(repo, version) {
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
}

function commit(repo, subject) {
  run('git', ['add', '.'], repo);
  run('git', ['commit', '-m', subject], repo);
}

function main() {
  const repo = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    run('git', ['init'], repo);
    run('git', ['config', 'user.name', 'Release Notes Test'], repo);
    run('git', ['config', 'user.email', 'release-notes@example.com'], repo);

    writePackage(repo, '1.0.0');
    commit(repo, 'chore: release 1.0.0');
    writeFileSync(join(repo, 'changes.txt'), 'first\n');
    commit(repo, 'feat: previous release feature');

    writePackage(repo, '1.0.1');
    commit(repo, 'chore: release 1.0.1');
    writeFileSync(join(repo, 'changes.txt'), 'second\n');
    commit(repo, 'fix: current release fix');

    const notes = run('node', [SCRIPT], repo);

    assert.match(notes, /current release fix/);
    assert.match(notes, /release 1\.0\.1/);
    assert.doesNotMatch(notes, /previous release feature/);

    writePackage(repo, '1.0.2');
    writeFileSync(join(repo, 'changes.txt'), 'third\n');
    commit(repo, 'feat: next release feature');
    writePackage(repo, '1.0.3');

    const uncommittedNotes = run('node', [SCRIPT], repo);
    assert.match(uncommittedNotes, /next release feature/);
    assert.doesNotMatch(uncommittedNotes, /current release fix/);

    const explicitNotes = run('node', [SCRIPT, '--from', 'HEAD~1'], repo);
    assert.match(explicitNotes, /next release feature/);
    assert.doesNotMatch(explicitNotes, /current release fix/);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
}

main();
console.log('generate-release-notes regression test passed');
