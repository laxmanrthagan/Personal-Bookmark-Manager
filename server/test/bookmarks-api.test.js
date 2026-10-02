import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';

async function startTestServer(titleFetcher, database = createDatabase()) {
  const app = createApp({ database, titleFetcher });
  let server;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidatePort = await new Promise((resolve, reject) => {
      const portProbe = createServer();
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', () => {
        const { port } = portProbe.address();
        portProbe.close((error) => error ? reject(error) : resolve(port));
      });
    });
    try {
      await new Promise((resolve, reject) => {
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        server = app.listen(candidatePort, '127.0.0.1');
        server.once('listening', onListening);
        server.once('error', onError);
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || attempt === 9) throw error;
    }
  }
  const { port } = server.address();

  return {
    database,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      database.close();
    },
  };
}

test('GET /api/bookmarks returns all bookmarks newest first with a stable tie-breaker', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const emptyResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual((await emptyResponse.json()).bookmarks, []);

  const insert = fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const olderId = Number(insert.run(
    'https://example.org/older',
    'https://example.org/older',
    'Older',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z',
  ).lastInsertRowid);
  const sameTimeLowerId = Number(insert.run(
    'https://example.org/same-a',
    'https://example.org/same-a',
    'Same time A',
    '2026-01-02T10:00:00.000Z',
    '2026-01-02T10:00:00.000Z',
  ).lastInsertRowid);
  const sameTimeHigherId = Number(insert.run(
    'https://example.org/same-b',
    'https://example.org/same-b',
    'Same time B',
    '2026-01-02T10:00:00.000Z',
    '2026-01-02T10:00:00.000Z',
  ).lastInsertRowid);
  const newestId = Number(insert.run(
    'https://example.org/newest',
    'https://example.org/newest',
    null,
    '2026-01-03T10:00:00.000Z',
    '2026-01-03T10:00:00.000Z',
  ).lastInsertRowid);
  const tagId = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Reading', 'reading').lastInsertRowid);
  fixture.database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  ).run(newestId, tagId);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.bookmarks.map(({ id }) => id), [newestId, sameTimeHigherId, sameTimeLowerId, olderId]);
  assert.equal(payload.bookmarks[0].title, null);
  assert.equal(payload.bookmarks[0].createdAt, '2026-01-03T10:00:00.000Z');
  assert.deepEqual(payload.bookmarks[0].tags, [{ id: tagId, name: 'Reading' }]);
  assert.deepEqual(payload.bookmarks[1].tags, []);

  const tagsResponse = await fetch(`${fixture.baseUrl}/api/tags`);
  assert.deepEqual((await tagsResponse.json()).tags, [{ id: tagId, name: 'Reading' }]);

  const filteredResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?tagId=${tagId}`);
  const filtered = await filteredResponse.json();
  assert.equal(filteredResponse.status, 200);
  assert.deepEqual(filtered.bookmarks.map(({ id }) => id), [newestId]);
  assert.deepEqual(filtered.bookmarks[0].tags, [{ id: tagId, name: 'Reading' }]);

  const unmatchedResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?tagId=999`);
  assert.deepEqual((await unmatchedResponse.json()).bookmarks, []);

  const invalidFilterResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?tagId=invalid`);
  const invalidFilter = await invalidFilterResponse.json();
  assert.equal(invalidFilterResponse.status, 400);
  assert.equal(invalidFilter.error.code, 'INVALID_TAG_FILTER');
});

test('GET /api/bookmarks searches titles and URLs case-insensitively and combines tag filters', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const insertBookmark = fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const matchingTag = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Research', 'research').lastInsertRowid);
  const otherTag = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Design', 'design').lastInsertRowid);
  const matchingTitleId = Number(insertBookmark.run(
    'https://example.org/notes', 'https://example.org/notes', 'Quiet Garden Notes',
    '2026-02-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z',
  ).lastInsertRowid);
  const matchingUrlId = Number(insertBookmark.run(
    'https://example.org/quiet-garden', 'https://example.org/quiet-garden', 'A saved page',
    '2026-02-02T10:00:00.000Z', '2026-02-02T10:00:00.000Z',
  ).lastInsertRowid);
  const wrongTagId = Number(insertBookmark.run(
    'https://example.org/quiet-garden-design', 'https://example.org/quiet-garden-design', 'Quiet Garden Design',
    '2026-02-03T10:00:00.000Z', '2026-02-03T10:00:00.000Z',
  ).lastInsertRowid);
  const literalWildcardId = Number(insertBookmark.run(
    'https://example.org/100%_complete', 'https://example.org/100%_complete', 'Literal wildcard',
    '2026-02-04T10:00:00.000Z', '2026-02-04T10:00:00.000Z',
  ).lastInsertRowid);
  const unicodeTitleId = Number(insertBookmark.run(
    'https://example.org/unicode', 'https://example.org/unicode', 'Äpfel und Märchen',
    '2026-02-05T10:00:00.000Z', '2026-02-05T10:00:00.000Z',
  ).lastInsertRowid);
  const linkBookmarkTag = fixture.database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  );
  linkBookmarkTag.run(matchingTitleId, matchingTag);
  linkBookmarkTag.run(matchingUrlId, matchingTag);
  linkBookmarkTag.run(wrongTagId, otherTag);

  const titleSearchResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=${encodeURIComponent('  QUIET GARDEN  ')}`);
  const titleSearch = await titleSearchResponse.json();
  assert.deepEqual(titleSearch.bookmarks.map(({ id }) => id), [wrongTagId, matchingTitleId]);

  const urlSearchResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=${encodeURIComponent('EXAMPLE.ORG/NOTES')}`);
  assert.deepEqual((await urlSearchResponse.json()).bookmarks.map(({ id }) => id), [matchingTitleId]);

  const combinedResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?tagId=${matchingTag}&q=quiet`);
  assert.deepEqual((await combinedResponse.json()).bookmarks.map(({ id }) => id), [matchingUrlId, matchingTitleId]);

  const wildcardResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=${encodeURIComponent('%_')}`);
  assert.deepEqual((await wildcardResponse.json()).bookmarks.map(({ id }) => id), [literalWildcardId]);

  const unicodeSearchResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=${encodeURIComponent('ÄPFEL')}`);
  assert.deepEqual((await unicodeSearchResponse.json()).bookmarks.map(({ id }) => id), [unicodeTitleId]);

  const blankQueryResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=%20%20`);
  assert.equal((await blankQueryResponse.json()).bookmarks.length, 5);
});

test('GET /api/bookmarks rejects malformed or excessively long search queries', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const repeatedQueryResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=one&q=two`);
  const repeatedQuery = await repeatedQueryResponse.json();
  assert.equal(repeatedQueryResponse.status, 400);
  assert.equal(repeatedQuery.error.code, 'INVALID_SEARCH');

  const longQueryResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?q=${'x'.repeat(201)}`);
  const longQuery = await longQueryResponse.json();
  assert.equal(longQueryResponse.status, 400);
  assert.equal(longQuery.error.code, 'INVALID_SEARCH');
});

test('bookmarks remain available through the API after closing and reopening the local server', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'bookmark-api-restart-'));
  const databasePath = join(directory, 'bookmarks.sqlite');
  let fixture = await startTestServer(async () => null, createDatabase(databasePath));
  context.after(async () => {
    if (fixture) await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const createResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/persisted-api', title: 'Persisted API bookmark', tags: ['Persistent'] }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const createdId = created.bookmark.id;

  await fixture.close();
  fixture = null;
  fixture = await startTestServer(async () => null, createDatabase(databasePath));

  const listResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`);
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.bookmarks.length, 1);
  assert.equal(list.bookmarks[0].id, createdId);
  assert.equal(list.bookmarks[0].title, 'Persisted API bookmark');
  assert.deepEqual(list.bookmarks[0].tags.map(({ name }) => name), ['Persistent']);
});

test('PATCH /api/bookmarks/:id updates URL, title, and tags atomically', async (context) => {
  let titleFetcherCalled = false;
  const fixture = await startTestServer(async () => {
    titleFetcherCalled = true;
    return 'Unexpected fetched title';
  });
  context.after(fixture.close);

  const originalTagId = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Old tag', 'old tag').lastInsertRowid);
  const bookmarkId = Number(fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'https://example.org/before', 'https://example.org/before', 'Before',
    '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z',
  ).lastInsertRowid);
  fixture.database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  ).run(bookmarkId, originalTagId);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks/${bookmarkId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.org/after',
      title: 'After',
      tags: ['New tag', ' NEW TAG '],
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(titleFetcherCalled, false);
  assert.equal(payload.bookmark.url, 'https://example.org/after');
  assert.equal(payload.bookmark.title, 'After');
  assert.ok(payload.bookmark.updatedAt > '2026-03-01T10:00:00.000Z');
  assert.deepEqual(payload.bookmark.tags.map(({ name }) => name), ['New tag']);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmark_tags WHERE bookmark_id = ?').get(bookmarkId).count, 1);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM tags WHERE id = ?').get(originalTagId).count, 0);
});

test('PATCH /api/bookmarks/:id supports partial updates and retrieves a title when a changed URL has no title', async (context) => {
  const fetchedUrls = [];
  const fixture = await startTestServer(async (url) => {
    fetchedUrls.push(url);
    return 'Retrieved after edit';
  });
  context.after(fixture.close);

  const tagId = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Keep me', 'keep me').lastInsertRowid);
  const bookmarkId = Number(fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'https://example.org/old', 'https://example.org/old', 'Old title',
    '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z',
  ).lastInsertRowid);
  fixture.database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  ).run(bookmarkId, tagId);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks/${bookmarkId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/new' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(fetchedUrls, ['https://example.org/new']);
  assert.equal(payload.bookmark.title, 'Retrieved after edit');
  assert.deepEqual(payload.bookmark.tags, [{ id: tagId, name: 'Keep me' }]);
});

test('PATCH /api/bookmarks/:id rejects invalid edits and reports missing records', async (context) => {
  const fixture = await startTestServer(async () => 'Fetched title');
  context.after(fixture.close);

  const bookmarkId = Number(fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'https://example.org/original', 'https://example.org/original', 'Original',
    '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z',
  ).lastInsertRowid);
  const before = fixture.database.prepare('SELECT url, title, updated_at FROM bookmarks WHERE id = ?').get(bookmarkId);

  for (const [body, expectedCode] of [
    [{ url: 'file:///private' }, 'INVALID_URL'],
    [{ title: 123 }, 'INVALID_TITLE'],
    [{ tags: ['good', 123] }, 'INVALID_TAGS'],
    [{}, 'EMPTY_UPDATE'],
  ]) {
    const response = await fetch(`${fixture.baseUrl}/api/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, expectedCode);
  }

  const missingResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/999`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Missing' }),
  });
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, 'BOOKMARK_NOT_FOUND');
  assert.deepEqual(fixture.database.prepare('SELECT url, title, updated_at FROM bookmarks WHERE id = ?').get(bookmarkId), before);
});

test('DELETE /api/bookmarks/:id removes the bookmark, cascades links, and keeps tags still in use', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const sharedTagId = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Shared', 'shared').lastInsertRowid);
  const orphanTagId = Number(fixture.database.prepare(
    'INSERT INTO tags (name, normalized_name) VALUES (?, ?)'
  ).run('Only on deleted item', 'only on deleted item').lastInsertRowid);
  const insertBookmark = fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deletedBookmarkId = Number(insertBookmark.run(
    'https://example.org/delete-me', 'https://example.org/delete-me', 'Delete me',
    '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z',
  ).lastInsertRowid);
  const retainedBookmarkId = Number(insertBookmark.run(
    'https://example.org/keep-me', 'https://example.org/keep-me', 'Keep me',
    '2026-04-02T10:00:00.000Z', '2026-04-02T10:00:00.000Z',
  ).lastInsertRowid);
  const link = fixture.database.prepare(
    'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
  );
  link.run(deletedBookmarkId, sharedTagId);
  link.run(deletedBookmarkId, orphanTagId);
  link.run(retainedBookmarkId, sharedTagId);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks/${deletedBookmarkId}`, { method: 'DELETE' });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { deleted: true, id: deletedBookmarkId });
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks WHERE id = ?').get(deletedBookmarkId).count, 0);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmark_tags WHERE bookmark_id = ?').get(deletedBookmarkId).count, 0);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM tags WHERE id = ?').get(sharedTagId).count, 1);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM tags WHERE id = ?').get(orphanTagId).count, 0);
  assert.deepEqual((await (await fetch(`${fixture.baseUrl}/api/tags`)).json()).tags, [{ id: sharedTagId, name: 'Shared' }]);
});

test('DELETE /api/bookmarks/:id validates the ID and reports already-missing bookmarks', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const invalidResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/abc`, { method: 'DELETE' });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, 'INVALID_BOOKMARK_ID');

  const missingResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/999`, { method: 'DELETE' });
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, 'BOOKMARK_NOT_FOUND');
});

test('POST /api/bookmarks saves a supplied title without fetching metadata', async (context) => {
  let titleFetchCalled = false;
  const fixture = await startTestServer(async () => {
    titleFetchCalled = true;
    return 'Should not be used';
  });
  context.after(fixture.close);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: fixture.baseUrl },
    body: JSON.stringify({ url: '  https://example.org/article  ', title: 'My article' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(titleFetchCalled, false);
  assert.equal(payload.bookmark.url, 'https://example.org/article');
  assert.equal(payload.bookmark.title, 'My article');
  assert.equal(payload.titleStatus, 'provided');
  assert.ok(fixture.database.prepare('SELECT id FROM bookmarks WHERE id = ?').get(payload.bookmark.id));
});

test('POST /api/bookmarks fetches a title when omitted', async (context) => {
  const requestedUrls = [];
  const fixture = await startTestServer(async (url) => {
    requestedUrls.push(url);
    return 'Page title from metadata';
  });
  context.after(fixture.close);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/guide' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(requestedUrls, ['https://example.org/guide']);
  assert.equal(payload.bookmark.title, 'Page title from metadata');
  assert.equal(payload.titleStatus, 'retrieved');
});

test('POST /api/bookmarks saves multiple normalized tags and reuses existing tags', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  async function addBookmark(url, tags) {
    const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title: 'Tagged page', tags }),
    });
    return { response, payload: await response.json() };
  }

  const first = await addBookmark('https://example.org/tagged-1', [' Research ', 'design', 'RESEARCH', '']);
  assert.equal(first.response.status, 201);
  assert.deepEqual(first.payload.bookmark.tags.map(({ name }) => name), ['Research', 'design']);

  const second = await addBookmark('https://example.org/tagged-2', ['research']);
  assert.equal(second.response.status, 201);
  assert.equal(second.payload.bookmark.tags[0].id, first.payload.bookmark.tags[0].id);
  assert.equal(second.payload.bookmark.tags[0].name, 'Research');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM tags').get().count, 2);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmark_tags').get().count, 3);
});

test('POST /api/bookmarks detects normalized duplicate URLs and returns the existing bookmark', async (context) => {
  let titleFetcherCalled = false;
  const fixture = await startTestServer(async () => {
    titleFetcherCalled = true;
    return 'Should not fetch for a duplicate';
  });
  context.after(fixture.close);

  const firstResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.org/articles/duplicate',
      title: 'Original saved bookmark',
      tags: ['Research'],
    }),
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201);

  const duplicateResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'HTTPS://EXAMPLE.ORG:443/articles/duplicate' }),
  });
  const duplicate = await duplicateResponse.json();

  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicate.error.code, 'DUPLICATE_URL');
  assert.equal(duplicate.existingBookmark.id, first.bookmark.id);
  assert.equal(duplicate.existingBookmark.title, 'Original saved bookmark');
  assert.deepEqual(duplicate.existingBookmark.tags.map(({ name }) => name), ['Research']);
  assert.equal(titleFetcherCalled, false);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 1);

  for (const [url, title] of [
    ['https://example.org/articles/duplicate?view=full', 'Different query'],
    ['https://example.org/articles/duplicate#section', 'Different fragment'],
  ]) {
    const distinctResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title }),
    });
    assert.equal(distinctResponse.status, 201);
  }
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 3);
});

test('POST /api/bookmarks rechecks duplicates after async title fetching to prevent a create race', async (context) => {
  let releaseTitleFetch;
  const titleFetchStarted = new Promise((resolve) => {
    releaseTitleFetch = resolve;
  });
  let finishTitleFetch;
  const titleFetchGate = new Promise((resolve) => {
    finishTitleFetch = resolve;
  });
  const fixture = await startTestServer(async () => {
    releaseTitleFetch();
    return titleFetchGate;
  });
  context.after(fixture.close);

  const firstPending = fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/race' }),
  });
  await titleFetchStarted;

  const secondResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'HTTPS://EXAMPLE.ORG:443/race', title: 'First committed' }),
  });
  assert.equal(secondResponse.status, 201);
  finishTitleFetch('Fetched later');

  const firstResponse = await firstPending;
  const firstResult = await firstResponse.json();
  assert.equal(firstResponse.status, 409);
  assert.equal(firstResult.error.code, 'DUPLICATE_URL');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 1);
});

test('PATCH /api/bookmarks/:id rejects URLs used by another bookmark but permits the same bookmark URL', async (context) => {
  const fixture = await startTestServer(async () => 'Fetched title');
  context.after(fixture.close);

  const insert = fixture.database.prepare(`
    INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const firstId = Number(insert.run(
    'https://example.org/one', 'https://example.org/one', 'One',
    '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:00.000Z',
  ).lastInsertRowid);
  const secondId = Number(insert.run(
    'https://example.org/two', 'https://example.org/two', 'Two',
    '2026-05-02T10:00:00.000Z', '2026-05-02T10:00:00.000Z',
  ).lastInsertRowid);

  const duplicateResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${secondId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'HTTPS://EXAMPLE.ORG:443/one' }),
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicate.error.code, 'DUPLICATE_URL');
  assert.equal(duplicate.existingBookmark.id, firstId);
  assert.equal(fixture.database.prepare('SELECT url FROM bookmarks WHERE id = ?').get(secondId).url, 'https://example.org/two');

  const sameBookmarkResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${firstId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'HTTPS://EXAMPLE.ORG:443/one', title: 'Same bookmark updated' }),
  });
  assert.equal(sameBookmarkResponse.status, 200);
  const updatedSelf = await sameBookmarkResponse.json();
  assert.equal(updatedSelf.bookmark.title, 'Same bookmark updated');
  assert.equal(updatedSelf.bookmark.url, 'HTTPS://EXAMPLE.ORG:443/one');
});

test('POST /api/bookmarks saves successfully when title retrieval fails', async (context) => {
  const fixture = await startTestServer(async () => {
    throw new Error('Remote site timed out');
  });
  context.after(fixture.close);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/slow' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.bookmark.title, null);
  assert.equal(payload.titleStatus, 'unavailable');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 1);
});

test('POST /api/bookmarks rejects invalid schemes and titles', async (context) => {
  let titleFetchCalled = false;
  const fixture = await startTestServer(async () => {
    titleFetchCalled = true;
    return 'Unexpected';
  });
  context.after(fixture.close);

  const invalidUrlResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'javascript:alert(1)' }),
  });
  const invalidUrl = await invalidUrlResponse.json();
  assert.equal(invalidUrlResponse.status, 400);
  assert.equal(invalidUrl.error.code, 'INVALID_URL');

  const invalidTitleResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org', title: 42 }),
  });
  const invalidTitle = await invalidTitleResponse.json();
  assert.equal(invalidTitleResponse.status, 400);
  assert.equal(invalidTitle.error.code, 'INVALID_TITLE');
  assert.equal(titleFetchCalled, false);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 0);
});

test('POST /api/bookmarks rejects empty, malformed, credential-bearing, whitespace, and oversized URLs', async (context) => {
  let titleFetcherCalled = false;
  const fixture = await startTestServer(async () => {
    titleFetcherCalled = true;
    return 'Should not be requested';
  });
  context.after(fixture.close);

  const invalidUrls = [
    '',
    '   ',
    'https://.',
    'https://example..com/',
    'https://example.com/path with space',
    'https://user:secret@example.com/',
    `https://example.com/${'x'.repeat(2049)}`,
  ];

  for (const url of invalidUrls) {
    const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title: 'Should not save' }),
    });
    assert.equal(response.status, 400, `Expected a clear rejection for ${url.slice(0, 60)}`);
    assert.equal((await response.json()).error.code, 'INVALID_URL');
  }

  assert.equal(titleFetcherCalled, false);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 0);
});

test('POST /api/bookmarks rejects malformed tag values without partial inserts', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/', title: 'Invalid tags', tags: ['valid', 42] }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'INVALID_TAGS');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM tags').get().count, 0);
});

test('POST /api/bookmarks ignores blank/repeated tag entries when applying the 20 unique-tag limit', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const twentyDistinctTags = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
  const acceptedResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.org/twenty-tags',
      title: 'Twenty tags',
      tags: [...twentyDistinctTags, '', '  ', 'TAG-0'],
    }),
  });
  const accepted = await acceptedResponse.json();
  assert.equal(acceptedResponse.status, 201);
  assert.equal(accepted.bookmark.tags.length, 20);

  const rejectedResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.org/twenty-one-tags',
      title: 'Twenty-one tags',
      tags: Array.from({ length: 21 }, (_, index) => `unique-${index}`),
    }),
  });
  assert.equal(rejectedResponse.status, 400);
  assert.equal((await rejectedResponse.json()).error.code, 'INVALID_TAGS');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 1);
});

test('rejects state-changing API requests from a non-loopback browser origin', async (context) => {
  const fixture = await startTestServer(async () => 'Should not be requested');
  context.after(fixture.close);

  const response = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ url: 'https://example.org/' }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'UNTRUSTED_ORIGIN');
  assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM bookmarks').get().count, 0);
});

test('marks and filters favorite bookmarks', async (context) => {
  const fixture = await startTestServer(async () => null);
  context.after(fixture.close);

  const createResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/favorite-me', title: 'Favorite candidate' }),
  });
  const created = await createResponse.json();
  assert.equal(created.bookmark.favorite, false);

  await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/not-favorite', title: 'Not a favorite' }),
  });

  const patchResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${created.bookmark.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: true }),
  });
  const patched = await patchResponse.json();
  assert.equal(patchResponse.status, 200);
  assert.equal(patched.bookmark.favorite, true);
  assert.equal(patched.bookmark.title, 'Favorite candidate');

  const filteredResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?favorite=true`);
  const filtered = await filteredResponse.json();
  assert.equal(filteredResponse.status, 200);
  assert.deepEqual(filtered.bookmarks.map(({ id }) => id), [created.bookmark.id]);

  const invalidFilterResponse = await fetch(`${fixture.baseUrl}/api/bookmarks?favorite=yes`);
  assert.equal(invalidFilterResponse.status, 400);
  assert.equal((await invalidFilterResponse.json()).error.code, 'INVALID_FAVORITE_FILTER');

  const invalidPatchResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${created.bookmark.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: 'true' }),
  });
  assert.equal(invalidPatchResponse.status, 400);
  assert.equal((await invalidPatchResponse.json()).error.code, 'INVALID_FAVORITE');
});

test('checks whether a saved link is still reachable', async (context) => {
  let shouldFail = false;
  const fixture = await startTestServer(async () => {
    if (shouldFail) throw new Error('Title lookup returned HTTP 404.');
    return 'Reachable page';
  });
  context.after(fixture.close);

  const createResponse = await fetch(`${fixture.baseUrl}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/link-check' }),
  });
  const { bookmark } = await createResponse.json();

  const reachableResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${bookmark.id}/check-link`, { method: 'POST' });
  const reachable = await reachableResponse.json();
  assert.equal(reachableResponse.status, 200);
  assert.equal(reachable.reachable, true);
  assert.ok(reachable.checkedAt);

  shouldFail = true;
  const brokenResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/${bookmark.id}/check-link`, { method: 'POST' });
  const broken = await brokenResponse.json();
  assert.equal(brokenResponse.status, 200);
  assert.equal(broken.reachable, false);
  assert.match(broken.message, /unreachable|broken/u);

  const missingResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/999999/check-link`, { method: 'POST' });
  assert.equal(missingResponse.status, 404);

  const invalidIdResponse = await fetch(`${fixture.baseUrl}/api/bookmarks/not-a-number/check-link`, { method: 'POST' });
  assert.equal(invalidIdResponse.status, 400);
});