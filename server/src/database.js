import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const schemaUrl = new URL('./database/schema.sql', import.meta.url);
const schemaSql = readFileSync(schemaUrl, 'utf8');
const schemaVersion = 2;

function hasColumn(database, table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function tableExists(database, table) {
  return Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(table));
}

function addFavoriteColumnIfMissing(database) {
  if (tableExists(database, 'bookmarks') && !hasColumn(database, 'bookmarks', 'favorite')) {
    database.exec('ALTER TABLE bookmarks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }
}

export function createDatabase(databasePath = ':memory:') {
  if (databasePath !== ':memory:' && !databasePath.startsWith('file:')) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') database.pragma('journal_mode = WAL');

  const currentVersion = database.pragma('user_version', { simple: true });
  if (currentVersion > schemaVersion) {
    database.close();
    throw new Error(`Database schema version ${currentVersion} is newer than this application supports.`);
  }

  if (currentVersion < schemaVersion) {
    database.exec('BEGIN IMMEDIATE');
    try {
      addFavoriteColumnIfMissing(database);
      database.exec(schemaSql);
      database.pragma(`user_version = ${schemaVersion}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  } else {
    // Re-run idempotent DDL so missing indexes are repaired if necessary.
    addFavoriteColumnIfMissing(database);
    database.exec(schemaSql);
  }

  return database;
}
