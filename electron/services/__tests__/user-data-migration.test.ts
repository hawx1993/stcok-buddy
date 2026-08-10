import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron-runtime.js', () => ({
  app: {
    getPath: vi.fn(),
  },
}));

import { listUserDataFilesForTest, migrateUserDataDirectory, readMigrationMarker } from '../user-data-migration.js';

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stockbuddy-userdata-migration-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('userData 目录迁移', () => {
  it('旧目录有数据且新目录只有空库时，将旧目录无感迁移到新目录并备份新目录', () => {
    const root = makeTempDir();
    const legacyPath = path.join(root, 'stockbuddy-desktop');
    const targetPath = path.join(root, 'StockBuddy');
    rmSync(legacyPath, { recursive: true, force: true });
    rmSync(targetPath, { recursive: true, force: true });
    mkdirSync(legacyPath, { recursive: true });
    mkdirSync(targetPath, { recursive: true });
    writeFileSync(path.join(legacyPath, 'stocksense-chat.sqlite'), 'legacy-chat', { flag: 'wx' });
    writeFileSync(path.join(legacyPath, 'stocksense-store.json'), JSON.stringify({ config: { model: { apiKey: 'sk-old' } } }), { flag: 'wx' });
    writeFileSync(path.join(targetPath, 'stocksense-chat.sqlite'), 'empty', { flag: 'wx' });

    const result = migrateUserDataDirectory({
      legacyPath,
      targetPath,
      now: new Date('2026-08-10T12:00:00.000Z'),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({ migrated: true, reason: 'renamed' });
    expect(readFileSync(path.join(targetPath, 'stocksense-chat.sqlite'), 'utf8')).toBe('legacy-chat');
    expect(readMigrationMarker(targetPath)).toContain('stockbuddy-desktop');
    expect(result.backupPath).toBeTruthy();
    expect(result.backupPath ? readFileSync(path.join(result.backupPath, 'stocksense-chat.sqlite'), 'utf8') : '').toBe('empty');
    expect(listUserDataFilesForTest(legacyPath)).toEqual([]);
  });

  it('新目录数据大于旧目录时不覆盖，避免误伤用户新数据', () => {
    const root = makeTempDir();
    const legacyPath = path.join(root, 'stockbuddy-desktop');
    const targetPath = path.join(root, 'StockBuddy');
    mkdirSync(legacyPath, { recursive: true });
    mkdirSync(targetPath, { recursive: true });
    writeFileSync(path.join(legacyPath, 'stocksense-chat.sqlite'), 'old', { flag: 'wx' });
    writeFileSync(path.join(targetPath, 'stocksense-chat.sqlite'), 'new-data-is-larger', { flag: 'wx' });

    const result = migrateUserDataDirectory({
      legacyPath,
      targetPath,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toEqual({ migrated: false, reason: 'target-newer-or-larger' });
    expect(readFileSync(path.join(targetPath, 'stocksense-chat.sqlite'), 'utf8')).toBe('new-data-is-larger');
    expect(readFileSync(path.join(legacyPath, 'stocksense-chat.sqlite'), 'utf8')).toBe('old');
  });
});
