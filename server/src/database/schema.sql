CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL CHECK (length(trim(url)) > 0),
  normalized_url TEXT NOT NULL,
  title TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (bookmark_id, tag_id),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created
  ON bookmarks (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_normalized_url
  ON bookmarks (normalized_url);
CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag
  ON bookmark_tags (tag_id, bookmark_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_favorite
  ON bookmarks (favorite, created_at DESC, id DESC);