import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createDatabase } from '../src/database.js';

const openDatabases = new Set();

function openMemoryDatabase() {
  const database = createDatabase();
  openDatabases.add(database);
  return database;
}

function insertBookmark(database, { url, normalizedUrl = url, title, createdAt }) {
  return database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(url, normalizedUrl, title ?? null, createdAt, createdAt).lastInsertRowid;
}

function insertTag(database, name, normalizedName = name.toLowerCase()) {
  return database.prepare(`
    INSERT INTO tags (name, normalized_name)
    VALUES (?, ?)
  `).run(name, normalizedName).lastInsertRowid;
}

afterEach(() => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
});

test('schema creates bookmark, tag, and many-to-many tables with foreign keys enabled', () => {
  const database = openMemoryDatabase();
  const tables = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map(({ name }) => name);

  assert.ok(tables.includes('bookmarks'));
  assert.ok(tables.includes('tags'));
  assert.ok(tables.includes('bookmark_tags'));
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(database.pragma('user_version', { simple: true }), 2);
});

test('favorite defaults to false and can be set on insert', () => {
  const database = openMemoryDatabase();
  const bookmarkId = insertBookmark(database, {
    url: 'https://example.org/starred',
    title: 'Starred',
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  assert.equal(database.prepare('SELECT favorite FROM bookmarks WHERE id = ?').get(bookmarkId).favorite, 0);

  database.prepare('UPDATE bookmarks SET favorite = 1 WHERE id = ?').run(bookmarkId);
  assert.equal(database.prepare('SELECT favorite FROM bookmarks WHERE id = ?').get(bookmarkId).favorite, 1);
  assert.throws(() => database.prepare('UPDATE bookmarks SET favorite = 2 WHERE id = ?').run(bookmarkId));
});

test('searches title or URL, filters by tag, and sorts newest first', () => {
  const database = openMemoryDatabase();
  const workTag = insertTag(database, 'Work');
  const readingTag = insertTag(database, 'Reading');
  const olderId = insertBookmark(database, {
    url: 'https://example.org/guide',
    title: 'Design notes',
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  const newerId = insertBookmark(database, {
    url: 'https://example.org/reference',
    title: 'Reference guide',
    createdAt: '2026-01-02T10:00:00.000Z',
  });
  database.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(olderId, workTag);
  database.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(olderId, readingTag);
  database.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(newerId, readingTag);

  const results = database.prepare(`
    SELECT b.id, b.title, b.url
    FROM bookmarks AS b
    WHERE (lower(coalesce(b.title, '')) LIKE lower(?) OR lower(b.url) LIKE lower(?))
      AND EXISTS (
        SELECT 1 FROM bookmark_tags AS bt
        WHERE bt.bookmark_id = b.id AND bt.tag_id = ?
      )
    ORDER BY b.created_at DESC, b.id DESC
  `).all('%guide%', '%guide%', readingTag);

  assert.deepEqual(results.map(({ id }) => id), [newerId, olderId]);

  const urlSearchResults = database.prepare(`
    SELECT id FROM bookmarks WHERE lower(url) LIKE lower(?)
  `).all('%/reference%');
  assert.deepEqual(urlSearchResults.map(({ id }) => id), [newerId]);
});

test('edits update bookmark fields and deletion cascades to bookmark_tags', () => {
  const database = openMemoryDatabase();
  const tagId = insertTag(database, 'Research');
  const bookmarkId = insertBookmark(database, {
    url: 'https://example.org/old',
    title: 'Old title',
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  database.prepare('INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(bookmarkId, tagId);

  database.prepare(`
    UPDATE bookmarks
    SET url = ?, normalized_url = ?, title = ?, updated_at = ?
    WHERE id = ?
  `).run(
    'https://example.org/new',
    'https://example.org/new',
    'Updated title',
    '2026-01-03T10:00:00.000Z',
    bookmarkId,
  );

  const updated = database.prepare('SELECT url, title, updated_at FROM bookmarks WHERE id = ?').get(bookmarkId);
  assert.equal(updated.url, 'https://example.org/new');
  assert.equal(updated.title, 'Updated title');
  assert.equal(updated.updated_at, '2026-01-03T10:00:00.000Z');

  database.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookmark_tags').get().count, 0);
});

test('persists bookmarks across database close and reopen', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmark-manager-'));
  const databasePath = join(directory, 'bookmarks.sqlite');
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const firstDatabase = createDatabase(databasePath);
  openDatabases.add(firstDatabase);
  const bookmarkId = insertBookmark(firstDatabase, {
    url: 'https://example.org/persistent',
    title: 'Persistent resource',
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  firstDatabase.close();
  openDatabases.delete(firstDatabase);

  const reopenedDatabase = createDatabase(databasePath);
  openDatabases.add(reopenedDatabase);
  const bookmark = reopenedDatabase.prepare('SELECT title FROM bookmarks WHERE id = ?').get(bookmarkId);
  assert.equal(bookmark.title, 'Persistent resource');
});

test('upgrades the pre-versioned scaffold database without losing rows', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmark-manager-legacy-'));
  const databasePath = join(directory, 'bookmarks.sqlite');
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const legacyDatabase = new Database(databasePath);
  legacyDatabase.pragma('foreign_keys = ON');
  legacyDatabase.exec(`
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL CHECK (length(trim(url)) > 0),
      normalized_url TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      normalized_name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE bookmark_tags (
      bookmark_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (bookmark_id, tag_id),
      FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);
  const bookmarkId = legacyDatabase.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'https://example.org/legacy',
    'https://example.org/legacy',
    'Legacy bookmark',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z',
  ).lastInsertRowid;
  const tagId = legacyDatabase.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Legacy', 'legacy').lastInsertRowid;
  legacyDatabase.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  ).run(bookmarkId, tagId);
  legacyDatabase.close();

  const migratedDatabase = createDatabase(databasePath);
  openDatabases.add(migratedDatabase);
  assert.equal(migratedDatabase.pragma('user_version', { simple: true }), 2);
  assert.equal(migratedDatabase.prepare('SELECT title FROM bookmarks WHERE id = ?').get(bookmarkId).title, 'Legacy bookmark');
  assert.equal(migratedDatabase.prepare('SELECT count(*) AS count FROM bookmark_tags').get().count, 1);
  assert.equal(migratedDatabase.prepare('SELECT favorite FROM bookmarks WHERE id = ?').get(bookmarkId).favorite, 0);
  assert.ok(migratedDatabase.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_bookmark_tags_tag'
  `).get());
});

test('enforces non-empty values, unique normalized tag names, and valid relationships', () => {
  const database = openMemoryDatabase();
  assert.throws(() => insertBookmark(database, {
    url: ' ',
    normalizedUrl: ' ',
    title: null,
    createdAt: '2026-01-01T10:00:00.000Z',
  }));

  insertTag(database, 'Work');
  assert.throws(() => insertTag(database, ' work ', 'work'));
  assert.throws(() => database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  ).run(999, 999));
});