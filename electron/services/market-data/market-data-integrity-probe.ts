/**
 * Standalone integrity probe for the market DuckDB.
 *
 * Runs as a child process (spawned with ELECTRON_RUN_AS_NODE) so a native
 * DuckDB crash on corrupted data cannot take down the app. Prints a
 * `SCAN <table>` line before scanning each table's string columns, then exits
 * 0 when the whole database is healthy. If a table's string column is corrupt,
 * DuckDB segfaults (SIGSEGV) mid-scan and the process dies — the parent uses
 * the last `SCAN <table>` line to identify the corrupt table.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

const dbPath = process.argv[2];

if (!dbPath) {
  console.error('usage: market-data-integrity-probe.js <dbPath>');
  process.exit(2);
}

async function listTables(connection: DuckDBConnection) {
  const result = await connection.run(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`,
  );
  return (await result.getRows()).map((row) => String(row[0]));
}

async function firstStringColumn(connection: DuckDBConnection, table: string) {
  const result = await connection.run(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $table AND data_type LIKE 'VARCHAR%'
     ORDER BY ordinal_position LIMIT 1`,
    { table },
  );
  const rows = await result.getRows();
  return rows.length ? String(rows[0][0]) : undefined;
}

async function main() {
  const instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  const connection = await instance.connect();
  try {
    const tables = await listTables(connection);
    for (const table of tables) {
      const column = await firstStringColumn(connection, table);
      if (!column) continue;
      process.stdout.write(`SCAN ${table}\n`);
      await connection.run(`SELECT "${column}" FROM "${table}"`);
    }
  } finally {
    connection.closeSync();
    process.exit(0);
  }
}

main().catch((error: unknown) => {
  console.error('[probe] failed', error);
  process.exit(3);
});
