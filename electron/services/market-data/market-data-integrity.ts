/**
 * Corrupted-market-database detection for the market DuckDB.
 *
 * DuckDB can segfault (SIGSEGV) with a native crash when it scans a corrupted
 * string value, and that crash cannot be caught in-process. The only way to
 * detect a corrupt table without taking down the app is to scan it in a child
 * process (see market-data-integrity-probe.ts) and let the child die.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROBE_TIMEOUT_MS = 60_000;

/**
 * Scans every string column of every table in the market DuckDB from a child
 * process. Returns the name of the table the probe died on (i.e. the corrupt
 * table), or an empty array when the database is healthy.
 *
 * Returns an empty array (and logs) when the probe cannot even run, so a
 * transient spawn failure never blocks the app.
 */
export function probeMarketDatabaseCorruption(dbPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    if (!existsSync(dbPath)) return resolve([]);
    const probeScript = fileURLToPath(new URL('./market-data-integrity-probe.js', import.meta.url));
    const child = spawn(process.execPath, [probeScript, dbPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) => {
      console.warn('[market-data] integrity probe spawn failed', error);
      resolve([]);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(extractCorruptTables(output));
    }, PROBE_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve([]);
      if (signal === 'SIGSEGV') return resolve(extractCorruptTables(output));
      // The probe itself errored (e.g. it could not open the DB) rather than
      // crashing on corrupt data — don't treat that as corruption, don't block.
      resolve([]);
    });
  });
}

/** Returns the last `SCAN <table>` progress line the probe printed before dying. */
export function extractCorruptTables(probeOutput: string): string[] {
  const lines = probeOutput.split('\n').map((line) => line.trim()).filter(Boolean);
  const scanned: string[] = [];
  for (const line of lines) {
    if (line.startsWith('SCAN ')) scanned.push(line.slice('SCAN '.length).trim());
  }
  const last = scanned[scanned.length - 1];
  return last ? [last] : [];
}
