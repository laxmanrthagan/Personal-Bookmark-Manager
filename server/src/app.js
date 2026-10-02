import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ipaddr from 'ipaddr.js';
import { fetchPageTitle } from './page-title.js';
import { normalizeTags, TagValidationError } from './tag-validation.js';
import { parseBookmarkUrl, UrlValidationError } from './url-validation.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(currentDir, '../../client/dist');
const MAX_TITLE_LENGTH = 300;
const TITLE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

function isLoopbackHost(hostname) {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (normalizedHostname === 'localhost') return true;
  try {
    return ipaddr.parse(normalizedHostname).range() === 'loopback';
  } catch {
    return false;
  }
}

function readBookmark(database, bookmarkId) {
  const rows = database.prepare(`
    SELECT b.id, b.url, b.title, b.favorite, b.created_at, b.updated_at,
           t.id AS tag_id, t.name AS tag_name
    FROM bookmarks AS b
    LEFT JOIN bookmark_tags AS bt ON bt.bookmark_id = b.id
    LEFT JOIN tags AS t ON t.id = bt.tag_id
    WHERE b.id = ?
    ORDER BY t.normalized_name ASC
  `).all(bookmarkId);
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    url: rows[0].url,
    title: rows[0].title,
    favorite: Boolean(rows[0].favorite),
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
    tags: rows.filter((row) => row.tag_id !== null).map((row) => ({ id: row.tag_id, name: row.tag_name })),
  };
}

function findDuplicateBookmark(database, normalizedUrl, excludingId = null) {
  const existing = excludingId === null
    ? database.prepare('SELECT id FROM bookmarks WHERE normalized_url = ? ORDER BY id LIMIT 1').get(normalizedUrl)
    : database.prepare('SELECT id FROM bookmarks WHERE normalized_url = ? AND id <> ? ORDER BY id LIMIT 1').get(normalizedUrl, excludingId);
  return existing ? readBookmark(database, existing.id) : null;
}

function sendDuplicateResponse(response, existingBookmark) {
  response.status(409).json({
    error: {
      code: 'DUPLICATE_URL',
      message: 'This URL is already saved. Open the existing bookmark or edit it instead.',
    },
    existingBookmark,
  });
}

export function createApp({ database, titleFetcher = fetchPageTitle } = {}) {
  if (!database) throw new TypeError('createApp requires a database connection.');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb', type: 'application/json' }));
  app.use('/api', (request, response, next) => {
    const requestHost = request.get('host')?.toLowerCase() ?? '';
    if (!isLoopbackHost(request.hostname)) {
      response.status(403).json({
        error: { code: 'UNTRUSTED_HOST', message: 'The local API accepts loopback requests only.' },
      });
      return;
    }

    const originHeader = request.get('origin');
    if (originHeader) {
      let origin;
      try {
        origin = new URL(originHeader);
      } catch {
        response.status(403).json({
          error: { code: 'UNTRUSTED_ORIGIN', message: 'Request origin is not allowed.' },
        });
        return;
      }
      const sameOrigin = origin.host.toLowerCase() === requestHost;
      const viteDevelopmentOrigin = process.env.NODE_ENV !== 'production' &&
        origin.protocol === 'http:' &&
        origin.port === '5173' &&
        isLoopbackHost(origin.hostname);
      if (
        !['http:', 'https:'].includes(origin.protocol) ||
        !isLoopbackHost(origin.hostname) ||
        (!sameOrigin && !viteDevelopmentOrigin)
      ) {
        response.status(403).json({
          error: { code: 'UNTRUSTED_ORIGIN', message: 'Request origin is not allowed.' },
        });
        return;
      }
    }
    next();
  });

  app.get('/api/health', (_request, response) => {
    try {
      database.prepare('SELECT 1').get();
      response.json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({ status: 'error', database: 'unavailable' });
    }
  });

  app.get('/api/tags', (_request, response) => {
    try {
      const tags = database.prepare(`
        SELECT t.id, t.name
        FROM tags AS t
        WHERE EXISTS (
          SELECT 1 FROM bookmark_tags AS bt WHERE bt.tag_id = t.id
        )
        ORDER BY t.normalized_name ASC
      `).all();
      response.json({ tags });
    } catch (error) {
      console.error('Could not list tags:', error.message);
      response.status(500).json({
        error: { code: 'TAG_LIST_FAILED', message: 'Tags could not be loaded.' },
      });
    }
  });

  app.get('/api/bookmarks', (request, response) => {
    try {
      const rawTagId = request.query.tagId;
      const rawSearch = request.query.q;
      const rawFavorite = request.query.favorite;
      let tagId = null;
      let searchTerm = '';
      let favoriteOnly = false;
      if (rawFavorite !== undefined) {
        if (rawFavorite !== 'true' && rawFavorite !== 'false') {
          response.status(400).json({
            error: { code: 'INVALID_FAVORITE_FILTER', message: 'The favorite filter must be true or false.' },
          });
          return;
        }
        favoriteOnly = rawFavorite === 'true';
      }
      if (rawTagId !== undefined) {
        if (typeof rawTagId !== 'string' || !/^[1-9]\d*$/u.test(rawTagId) || !Number.isSafeInteger(Number(rawTagId))) {
          response.status(400).json({
            error: { code: 'INVALID_TAG_FILTER', message: 'Select a valid tag.' },
          });
          return;
        }
        tagId = Number(rawTagId);
      }

      if (rawSearch !== undefined) {
        if (typeof rawSearch !== 'string' || rawSearch.length > 200) {
          response.status(400).json({
            error: { code: 'INVALID_SEARCH', message: 'Search must be 200 characters or fewer.' },
          });
          return;
        }
        searchTerm = rawSearch.trim();
      }

      const conditions = [];
      const parameters = [];
      if (tagId !== null) {
        conditions.push(`EXISTS (
            SELECT 1 FROM bookmark_tags AS filter_tags
            WHERE filter_tags.bookmark_id = b.id AND filter_tags.tag_id = ?
          )`);
        parameters.push(tagId);
      }
      if (favoriteOnly) {
        conditions.push('b.favorite = 1');
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = database.prepare(`
        SELECT b.id, b.url, b.title, b.favorite, b.created_at, b.updated_at,
               t.id AS tag_id, t.name AS tag_name
        FROM bookmarks AS b
        LEFT JOIN bookmark_tags AS bt ON bt.bookmark_id = b.id
        LEFT JOIN tags AS t ON t.id = bt.tag_id
        ${whereClause}
        ORDER BY b.created_at DESC, b.id DESC, t.normalized_name ASC
      `).all(...parameters);

      const byId = new Map();
      for (const row of rows) {
        let bookmark = byId.get(row.id);
        if (!bookmark) {
          bookmark = {
            id: row.id,
            url: row.url,
            title: row.title,
            favorite: Boolean(row.favorite),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            tags: [],
          };
          byId.set(row.id, bookmark);
        }
        if (row.tag_id !== null) bookmark.tags.push({ id: row.tag_id, name: row.tag_name });
      }

      let results = [...byId.values()];
      if (searchTerm) {
        const normalizedSearch = searchTerm.toLowerCase();
        results = results.filter((bookmark) => (
          (bookmark.title ?? '').toLowerCase().includes(normalizedSearch) ||
          bookmark.url.toLowerCase().includes(normalizedSearch)
        ));
      }

      response.json({ bookmarks: results });
    } catch (error) {
      console.error('Could not list bookmarks:', error.message);
      response.status(500).json({
        error: { code: 'LIST_FAILED', message: 'Bookmarks could not be loaded.' },
      });
    }
  });

  app.post('/api/bookmarks', async (request, response) => {
    const body = request.body ?? {};
    let parsedBookmarkUrl;
    let title = null;
    let titleStatus = 'unavailable';

    try {
      parsedBookmarkUrl = parseBookmarkUrl(body.url);
    } catch (error) {
      if (error instanceof UrlValidationError) {
        response.status(400).json({ error: { code: 'INVALID_URL', message: error.message } });
        return;
      }
      throw error;
    }

    if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') {
      response.status(400).json({
        error: { code: 'INVALID_TITLE', message: 'Title must be text.' },
      });
      return;
    }

    let tags;
    try {
      tags = normalizeTags(body.tags);
    } catch (error) {
      if (error instanceof TagValidationError) {
        response.status(400).json({ error: { code: 'INVALID_TAGS', message: error.message } });
        return;
      }
      throw error;
    }

    const suppliedTitle = typeof body.title === 'string'
      ? body.title.replace(TITLE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim()
      : '';
    if (suppliedTitle.length > MAX_TITLE_LENGTH) {
      response.status(400).json({
        error: { code: 'TITLE_TOO_LONG', message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
      });
      return;
    }

    const existingBookmark = findDuplicateBookmark(database, parsedBookmarkUrl.normalizedUrl);
    if (existingBookmark) {
      sendDuplicateResponse(response, existingBookmark);
      return;
    }

    if (suppliedTitle) {
      title = suppliedTitle;
      titleStatus = 'provided';
    } else {
      try {
        title = await titleFetcher(parsedBookmarkUrl.submittedUrl);
        if (typeof title === 'string') {
          title = title.replace(TITLE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE_LENGTH) || null;
        } else {
          title = null;
        }
        titleStatus = title ? 'retrieved' : 'unavailable';
      } catch {
        title = null;
        titleStatus = 'unavailable';
      }
    }

    const timestamp = new Date().toISOString();
    try {
      const saveBookmark = database.transaction(() => {
        const duplicate = findDuplicateBookmark(database, parsedBookmarkUrl.normalizedUrl);
        if (duplicate) return { duplicate };

        const result = database.prepare(`
          INSERT INTO bookmarks (url, normalized_url, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          parsedBookmarkUrl.submittedUrl,
          parsedBookmarkUrl.normalizedUrl,
          title,
          timestamp,
          timestamp,
        );
        const bookmarkId = Number(result.lastInsertRowid);
        const storedTags = [];

        for (const tag of tags) {
          database.prepare(`
            INSERT INTO tags (name, normalized_name)
            VALUES (?, ?)
            ON CONFLICT (normalized_name) DO NOTHING
          `).run(tag.name, tag.normalizedName);
          const storedTag = database.prepare(
            'SELECT id, name FROM tags WHERE normalized_name = ?'
          ).get(tag.normalizedName);
          database.prepare(
            'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
          ).run(bookmarkId, storedTag.id);
          storedTags.push({ id: Number(storedTag.id), name: storedTag.name });
        }

        return { bookmarkId, storedTags, duplicate: null };
      });
      const { bookmarkId, storedTags, duplicate } = saveBookmark();
      if (duplicate) {
        sendDuplicateResponse(response, duplicate);
        return;
      }

      response.status(201).json({
        bookmark: {
          id: bookmarkId,
          url: parsedBookmarkUrl.submittedUrl,
          title,
          favorite: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          tags: storedTags,
        },
        titleStatus,
      });
    } catch (error) {
      console.error('Could not save bookmark:', error.message);
      response.status(500).json({
        error: { code: 'SAVE_FAILED', message: 'The bookmark could not be saved.' },
      });
    }
  });

  app.patch('/api/bookmarks/:id', async (request, response) => {
    const rawId = request.params.id;
    if (!/^[1-9]\d*$/u.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      response.status(400).json({
        error: { code: 'INVALID_BOOKMARK_ID', message: 'Select a valid bookmark.' },
      });
      return;
    }

    const bookmarkId = Number(rawId);
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      response.status(400).json({
        error: { code: 'INVALID_UPDATE', message: 'Provide bookmark fields to update.' },
      });
      return;
    }
    const hasUrl = Object.hasOwn(body, 'url');
    const hasTitle = Object.hasOwn(body, 'title');
    const hasTags = Object.hasOwn(body, 'tags');
    const hasFavorite = Object.hasOwn(body, 'favorite');
    if (!hasUrl && !hasTitle && !hasTags && !hasFavorite) {
      response.status(400).json({
        error: { code: 'EMPTY_UPDATE', message: 'Choose at least one field to update.' },
      });
      return;
    }

    if (hasFavorite && typeof body.favorite !== 'boolean') {
      response.status(400).json({
        error: { code: 'INVALID_FAVORITE', message: 'Favorite must be true or false.' },
      });
      return;
    }

    const existing = database.prepare(`
      SELECT id, url, normalized_url, title, favorite, created_at
      FROM bookmarks WHERE id = ?
    `).get(bookmarkId);
    if (!existing) {
      response.status(404).json({
        error: { code: 'BOOKMARK_NOT_FOUND', message: 'That bookmark no longer exists.' },
      });
      return;
    }

    let parsedBookmarkUrl = { submittedUrl: existing.url, normalizedUrl: existing.normalized_url };
    if (hasUrl) {
      try {
        parsedBookmarkUrl = parseBookmarkUrl(body.url);
      } catch (error) {
        if (error instanceof UrlValidationError) {
          response.status(400).json({ error: { code: 'INVALID_URL', message: error.message } });
          return;
        }
        throw error;
      }
    }

    if (hasTitle && body.title !== null && typeof body.title !== 'string') {
      response.status(400).json({ error: { code: 'INVALID_TITLE', message: 'Title must be text.' } });
      return;
    }
    const suppliedTitle = typeof body.title === 'string'
      ? body.title.replace(TITLE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim()
      : '';
    if (suppliedTitle.length > MAX_TITLE_LENGTH) {
      response.status(400).json({
        error: { code: 'TITLE_TOO_LONG', message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
      });
      return;
    }

    let tags;
    if (hasTags) {
      try {
        tags = normalizeTags(body.tags);
      } catch (error) {
        if (error instanceof TagValidationError) {
          response.status(400).json({ error: { code: 'INVALID_TAGS', message: error.message } });
          return;
        }
        throw error;
      }
    }

    const urlChanged = parsedBookmarkUrl.normalizedUrl !== existing.normalized_url;
    const duplicateBookmark = urlChanged
      ? findDuplicateBookmark(database, parsedBookmarkUrl.normalizedUrl, bookmarkId)
      : null;
    if (duplicateBookmark) {
      sendDuplicateResponse(response, duplicateBookmark);
      return;
    }

    let nextTitle = hasTitle ? suppliedTitle || null : existing.title;
    let titleStatus = hasTitle ? (suppliedTitle ? 'provided' : 'cleared') : 'unchanged';
    const nextFavorite = hasFavorite ? (body.favorite ? 1 : 0) : existing.favorite;
    if (urlChanged && !suppliedTitle && (!hasTitle || !body.title)) {
      try {
        const fetchedTitle = await titleFetcher(parsedBookmarkUrl.submittedUrl);
        nextTitle = typeof fetchedTitle === 'string'
          ? fetchedTitle.replace(TITLE_CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE_LENGTH) || null
          : null;
        titleStatus = nextTitle ? 'retrieved' : 'unavailable';
      } catch {
        nextTitle = null;
        titleStatus = 'unavailable';
      }
    }

    const timestamp = new Date().toISOString();
    try {
      const updateBookmark = database.transaction(() => {
        const duplicate = urlChanged
          ? findDuplicateBookmark(database, parsedBookmarkUrl.normalizedUrl, bookmarkId)
          : null;
        if (duplicate) return { duplicate };

        const result = database.prepare(`
          UPDATE bookmarks
          SET url = ?, normalized_url = ?, title = ?, favorite = ?, updated_at = ?
          WHERE id = ?
        `).run(
          parsedBookmarkUrl.submittedUrl,
          parsedBookmarkUrl.normalizedUrl,
          nextTitle,
          nextFavorite,
          timestamp,
          bookmarkId,
        );
        if (result.changes !== 1) return { notFound: true };

        if (hasTags) {
          database.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(bookmarkId);
          for (const tag of tags) {
            database.prepare(`
              INSERT INTO tags (name, normalized_name)
              VALUES (?, ?)
              ON CONFLICT (normalized_name) DO NOTHING
            `).run(tag.name, tag.normalizedName);
            const storedTag = database.prepare(
              'SELECT id FROM tags WHERE normalized_name = ?'
            ).get(tag.normalizedName);
            database.prepare(
              'INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)'
            ).run(bookmarkId, storedTag.id);
          }
          database.prepare(`
            DELETE FROM tags
            WHERE NOT EXISTS (
              SELECT 1 FROM bookmark_tags WHERE bookmark_tags.tag_id = tags.id
            )
          `).run();
        }
        return { duplicate: null, notFound: false };
      });

      const updateResult = updateBookmark();
      if (updateResult.duplicate) {
        sendDuplicateResponse(response, updateResult.duplicate);
        return;
      }
      if (updateResult.notFound) {
        response.status(404).json({ error: { code: 'BOOKMARK_NOT_FOUND', message: 'That bookmark no longer exists.' } });
        return;
      }

      const updatedBookmark = readBookmark(database, bookmarkId);

      response.json({ bookmark: updatedBookmark, titleStatus });
    } catch (error) {
      console.error('Could not update bookmark:', error.message);
      response.status(500).json({
        error: { code: 'UPDATE_FAILED', message: 'The bookmark could not be updated.' },
      });
    }
  });

  app.delete('/api/bookmarks/:id', (request, response) => {
    const rawId = request.params.id;
    if (!/^[1-9]\d*$/u.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      response.status(400).json({
        error: { code: 'INVALID_BOOKMARK_ID', message: 'Select a valid bookmark.' },
      });
      return;
    }

    const bookmarkId = Number(rawId);
    try {
      const deleteBookmark = database.transaction(() => {
        const result = database.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
        if (result.changes !== 1) return false;

        database.prepare(`
          DELETE FROM tags
          WHERE NOT EXISTS (
            SELECT 1 FROM bookmark_tags WHERE bookmark_tags.tag_id = tags.id
          )
        `).run();
        return true;
      });

      if (!deleteBookmark()) {
        response.status(404).json({
          error: { code: 'BOOKMARK_NOT_FOUND', message: 'That bookmark no longer exists.' },
        });
        return;
      }

      response.json({ deleted: true, id: bookmarkId });
    } catch (error) {
      console.error('Could not delete bookmark:', error.message);
      response.status(500).json({
        error: { code: 'DELETE_FAILED', message: 'The bookmark could not be deleted.' },
      });
    }
  });

  app.post('/api/bookmarks/:id/check-link', async (request, response) => {
    const rawId = request.params.id;
    if (!/^[1-9]\d*$/u.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      response.status(400).json({
        error: { code: 'INVALID_BOOKMARK_ID', message: 'Select a valid bookmark.' },
      });
      return;
    }

    const bookmarkId = Number(rawId);
    const existing = database.prepare('SELECT id, url FROM bookmarks WHERE id = ?').get(bookmarkId);
    if (!existing) {
      response.status(404).json({
        error: { code: 'BOOKMARK_NOT_FOUND', message: 'That bookmark no longer exists.' },
      });
      return;
    }

    // Reuse the same SSRF-hardened fetch used for title lookup; any failure means the link is unreachable.
    try {
      await titleFetcher(existing.url);
      response.json({ reachable: true, checkedAt: new Date().toISOString() });
    } catch {
      response.json({
        reachable: false,
        message: 'This link could not be reached. It may be broken or temporarily unavailable.',
        checkedAt: new Date().toISOString(),
      });
    }
  });

  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(resolve(clientDist, 'index.html'));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
      });
      return;
    }
    if (error.type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large.' },
      });
      return;
    }
    console.error('Unhandled request error:', error.message);
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' },
    });
  });

  return app;
}