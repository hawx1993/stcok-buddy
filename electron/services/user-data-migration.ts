import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from '../electron-runtime.js';

const LEGACY_USER_DATA_DIR_NAME = 'stockbuddy-desktop';
const MIGRATION_MARKER_FILE = '.stockbuddy-userdata-migrated';
const MIGRATION_BACKUP_PREFIX = 'StockBuddy.migration-backup';

const knownDataFiles = [
  'stocksense-chat.sqlite',
  'stocksense-store.json',
  'stocksense-market.duckdb',
  'stocksense-market-dev.duckdb',
  'stocksense-monitor.duckdb',
  'stocksense-monitor-dev.duckdb',
  'stocksense-quotes.sqlite',
  'stocksense-quotes-dev.sqlite',
  'stocksense-surge.duckdb',
  'stocksense-surge-dev.duckdb',
] as const;

export interface IUserDataMigrationOptions {
  legacyPath: string;
  targetPath: string;
  now?: Date;
  logger?: Pick<Console, 'log' | 'warn'>;
}

interface IUserDataMigrationResult {
  migrated: boolean;
  reason: string;
  backupPath?: string;
}

export function migrateLegacyUserData() {
  if (process.env.STOCKBUDDY_SKIP_USER_DATA_MIGRATION === '1') return;
  const appDataPath = app.getPath('appData');
  const legacyPath = path.join(appDataPath, LEGACY_USER_DATA_DIR_NAME);
  const targetPath = app.getPath('userData');
  const result = migrateUserDataDirectory({ legacyPath, targetPath, logger: console });
  if (result.migrated) console.log('[user-data-migration] completed', result);
}

export function migrateUserDataDirectory({
  legacyPath,
  targetPath,
  now = new Date(),
  logger = console,
}: IUserDataMigrationOptions): IUserDataMigrationResult {
  const normalizedLegacyPath = path.resolve(legacyPath);
  const normalizedTargetPath = path.resolve(targetPath);
  if (normalizedLegacyPath === normalizedTargetPath) return { migrated: false, reason: 'same-path' };
  if (!existsSync(normalizedLegacyPath)) return { migrated: false, reason: 'legacy-missing' };

  const targetMarkerPath = path.join(normalizedTargetPath, MIGRATION_MARKER_FILE);
  if (existsSync(targetMarkerPath)) return { migrated: false, reason: 'already-migrated' };

  const legacyDataSize = dataSize(normalizedLegacyPath);
  if (legacyDataSize <= 0) return { migrated: false, reason: 'legacy-empty' };

  const targetExists = existsSync(normalizedTargetPath);
  const targetDataSize = targetExists ? dataSize(normalizedTargetPath) : 0;
  if (targetDataSize > legacyDataSize) {
    logger.warn('[user-data-migration] skipped because target data is larger than legacy data', {
      legacyPath: normalizedLegacyPath,
      targetPath: normalizedTargetPath,
      legacyDataSize,
      targetDataSize,
    });
    return { migrated: false, reason: 'target-newer-or-larger' };
  }

  let backupPath: string | undefined;
  if (targetExists) {
    backupPath = nextBackupPath(normalizedTargetPath, now);
    renameSync(normalizedTargetPath, backupPath);
  } else {
    mkdirSync(path.dirname(normalizedTargetPath), { recursive: true });
  }

  try {
    renameSync(normalizedLegacyPath, normalizedTargetPath);
    writeMigrationMarker(normalizedTargetPath, normalizedLegacyPath, backupPath, now);
    return { migrated: true, reason: 'renamed', backupPath };
  } catch (error) {
    restoreTargetAfterFailedMigration(normalizedTargetPath, backupPath, logger);
    throw error;
  }
}

function dataSize(dirPath: string) {
  if (!existsSync(dirPath)) return 0;
  return knownDataFiles.reduce((total, fileName) => {
    const filePath = path.join(dirPath, fileName);
    return total + safeFileSize(filePath) + safeFileSize(`${filePath}.wal`);
  }, 0);
}

function safeFileSize(filePath: string) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function nextBackupPath(targetPath: string, now: Date) {
  const backupBasePath = path.join(path.dirname(targetPath), `${MIGRATION_BACKUP_PREFIX}-${toSafeTimestamp(now)}`);
  if (!existsSync(backupBasePath)) return backupBasePath;
  for (let index = 1; index < 100; index += 1) {
    const candidate = `${backupBasePath}-${index}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('无法创建 userData 迁移备份目录');
}

function toSafeTimestamp(date: Date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function writeMigrationMarker(targetPath: string, legacyPath: string, backupPath: string | undefined, migratedAt: Date) {
  writeFileSync(
    path.join(targetPath, MIGRATION_MARKER_FILE),
    JSON.stringify(
      {
        migratedAt: migratedAt.toISOString(),
        legacyPath,
        backupPath,
      },
      null,
      2,
    ),
  );
}

function restoreTargetAfterFailedMigration(targetPath: string, backupPath: string | undefined, logger: Pick<Console, 'warn'>) {
  if (!backupPath || existsSync(targetPath) || !existsSync(backupPath)) return;
  try {
    renameSync(backupPath, targetPath);
  } catch (restoreError) {
    logger.warn('[user-data-migration] failed to restore target backup after migration failure', restoreError);
  }
}

export function readMigrationMarker(targetPath: string): string | undefined {
  const markerPath = path.join(targetPath, MIGRATION_MARKER_FILE);
  if (!existsSync(markerPath)) return undefined;
  return readFileSync(markerPath, 'utf8');
}

export function removeMigrationBackupForTest(backupPath: string | undefined) {
  if (backupPath && existsSync(backupPath)) rmSync(backupPath, { recursive: true, force: true });
}

export function listUserDataFilesForTest(dirPath: string) {
  return existsSync(dirPath) ? readdirSync(dirPath).sort() : [];
}
