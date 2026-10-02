import { useEffect, useRef, useState } from 'react';
import { validateBookmarkTitle, validateBookmarkUrl, validateTagInput } from './validation.js';

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function formatSavedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function App() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [apiError, setApiError] = useState('');
  const [healthRetryKey, setHealthRetryKey] = useState(0);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedBookmark, setSavedBookmark] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [bookmarksError, setBookmarksError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [availableTags, setAvailableTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagFilterError, setTagFilterError] = useState('');
  const [tagsRetryKey, setTagsRetryKey] = useState(0);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingBookmark, setEditingBookmark] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [urlError, setUrlError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [tagsError, setTagsError] = useState('');
  const [deletingBookmark, setDeletingBookmark] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [duplicateBookmark, setDuplicateBookmark] = useState(null);
  const [editDuplicateBookmark, setEditDuplicateBookmark] = useState(null);
  const [operationNotice, setOperationNotice] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [linkChecks, setLinkChecks] = useState({});
  const [importing, setImporting] = useState(false);
  const [theme, setTheme] = useState(() => {
    const stored = window.localStorage.getItem('pinboard-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const dialogRef = useRef(null);
  const focusReturnRef = useRef(null);
  const hadDialogOpenRef = useRef(false);
  const collectionHeadingRef = useRef(null);
  const importInputRef = useRef(null);
  const activeDialogType = editingBookmark ? 'edit' : deletingBookmark ? 'delete' : '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('pinboard-theme', theme);
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    setApiStatus('checking');
    setApiError('');

    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('The local API is not responding.');
        return response.json();
      })
      .then((health) => {
        if (health.database === 'connected') setApiStatus('connected');
        else throw new Error('Local bookmark storage is unavailable.');
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setApiStatus('unavailable');
          setApiError(requestError.message || 'Could not connect to the local app.');
        }
      });

    return () => controller.abort();
  }, [healthRetryKey]);

  useEffect(() => {
    const controller = new AbortController();
    setBookmarksLoading(true);
    setBookmarksError('');

    const query = new URLSearchParams();
    if (selectedTagId) query.set('tagId', selectedTagId);
    if (searchTerm) query.set('q', searchTerm);
    if (favoriteOnly) query.set('favorite', 'true');
    const queryString = query.size > 0 ? `?${query.toString()}` : '';

    fetch(`/api/bookmarks${queryString}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? 'Bookmarks could not be loaded.');
        return result.bookmarks;
      })
      .then(setBookmarks)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setBookmarksError(requestError.message || 'Could not load saved bookmarks.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBookmarksLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey, selectedTagId, searchTerm, favoriteOnly]);

  useEffect(() => {
    const controller = new AbortController();
    setTagsLoading(true);
    setTagFilterError('');

    fetch('/api/tags', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? 'Tags could not be loaded.');
        return result.tags;
      })
      .then((tags) => {
        setAvailableTags(tags);
        setTagsLoading(false);
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setTagFilterError(requestError.message || 'Could not load available tags.');
          setTagsLoading(false);
        }
      });

    return () => controller.abort();
  }, [refreshKey, tagsRetryKey]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  function closeEdit() {
    setEditingBookmark(null);
    setEditError('');
    setEditDuplicateBookmark(null);
    setUrlError('');
    setTitleError('');
    setTagsError('');
  }

  useEffect(() => {
    if (!activeDialogType) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const getFocusableElements = () => [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
    const focusableElements = getFocusableElements();
    (dialog.querySelector('[data-dialog-initial-focus]') ?? focusableElements[0])?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape' && activeDialogType === 'edit' && !editSaving) {
        closeEdit();
        return;
      }
      if (event.key === 'Escape' && activeDialogType === 'delete' && !deleteSaving) {
        setDeletingBookmark(null);
        return;
      }
      if (event.key === 'Tab') {
        const currentFocusableElements = getFocusableElements();
        if (currentFocusableElements.length === 0) {
          event.preventDefault();
          return;
        }
        const first = currentFocusableElements[0];
        const last = currentFocusableElements.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeDialogType, editSaving, deleteSaving]);

  useEffect(() => {
    if (activeDialogType) {
      hadDialogOpenRef.current = true;
      return;
    }
    if (!hadDialogOpenRef.current) return;

    hadDialogOpenRef.current = false;
    const previousFocus = focusReturnRef.current;
    focusReturnRef.current = null;
    if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    else collectionHeadingRef.current?.focus();
  }, [activeDialogType]);

  async function handleSubmit(event) {
    event.preventDefault();
    const nextUrlError = validateBookmarkUrl(url);
    const nextTitleError = validateBookmarkTitle(title);
    const nextTagsError = validateTagInput(tagsInput);
    setUrlError(nextUrlError);
    setTitleError(nextTitleError);
    setTagsError(nextTagsError);
    if (nextUrlError || nextTitleError || nextTagsError) {
      if (nextUrlError) document.getElementById('bookmark-url')?.focus();
      else if (nextTitleError) document.getElementById('bookmark-title')?.focus();
      else document.getElementById('bookmark-tags')?.focus();
      return;
    }

    setSubmitting(true);
    setError('');
    setSavedBookmark(null);
    setDuplicateBookmark(null);
    setOperationNotice('');

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title, tags: tagsInput.split(',') }),
      });
      const result = await response.json();

      if (!response.ok) {
        const message = result.error?.message ?? 'The bookmark could not be saved.';
        if (result.error?.code === 'INVALID_URL') setUrlError(message);
        else if (['INVALID_TITLE', 'TITLE_TOO_LONG'].includes(result.error?.code)) setTitleError(message);
        else if (result.error?.code === 'INVALID_TAGS') setTagsError(message);
        else if (result.error?.code === 'DUPLICATE_URL') {
          setDuplicateBookmark(result.existingBookmark);
          setError(message);
        } else setError(message);
        return;
      }

      setSavedBookmark(result);
      setOperationNotice('');
      setUrl('');
      setTitle('');
      setTagsInput('');
      setSelectedTagId('');
      setRefreshKey((current) => current + 1);
    } catch (submitError) {
      setError(submitError.message || 'Could not connect to the local app. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function beginEdit(bookmark) {
    focusReturnRef.current = document.activeElement;
    setOperationNotice('');
    setEditingBookmark({
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title ?? '',
      tags: (bookmark.tags ?? []).map((tag) => tag.name).join(', '),
    });
    setEditError('');
    setUrlError('');
    setTitleError('');
    setTagsError('');
    setEditDuplicateBookmark(null);
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    const nextUrlError = validateBookmarkUrl(editingBookmark.url);
    const nextTitleError = validateBookmarkTitle(editingBookmark.title);
    const nextTagsError = validateTagInput(editingBookmark.tags);
    setUrlError(nextUrlError);
    setTitleError(nextTitleError);
    setTagsError(nextTagsError);
    if (nextUrlError || nextTitleError || nextTagsError) {
      if (nextUrlError) document.getElementById('edit-bookmark-url')?.focus();
      else if (nextTitleError) document.getElementById('edit-bookmark-title')?.focus();
      else document.getElementById('edit-bookmark-tags')?.focus();
      return;
    }

    setEditSaving(true);
    setEditError('');
    setEditDuplicateBookmark(null);

    try {
      const response = await fetch(`/api/bookmarks/${editingBookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: editingBookmark.url,
          title: editingBookmark.title,
          tags: editingBookmark.tags.split(','),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const message = result.error?.message ?? 'The bookmark could not be updated.';
        if (result.error?.code === 'INVALID_URL') setUrlError(message);
        else if (['INVALID_TITLE', 'TITLE_TOO_LONG'].includes(result.error?.code)) setTitleError(message);
        else if (result.error?.code === 'INVALID_TAGS') setTagsError(message);
        else if (result.error?.code === 'DUPLICATE_URL') setEditDuplicateBookmark(result.existingBookmark);
        else setEditError(message);
        return;
      }

      setEditingBookmark(null);
      setEditDuplicateBookmark(null);
      setOperationNotice(result.titleStatus === 'unavailable'
        ? 'Changes saved, but the page title could not be retrieved. You can enter a title manually.'
        : 'Bookmark changes saved.');
      setRefreshKey((current) => current + 1);
    } catch (submitError) {
      setEditError(submitError.message || 'Could not update the bookmark. Try again.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingBookmark) return;
    setDeleteSaving(true);
    setDeleteError('');
    setOperationNotice('');
    try {
      const response = await fetch(`/api/bookmarks/${deletingBookmark.id}`, { method: 'DELETE' });
      const result = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'The bookmark could not be deleted.');

      setDeletingBookmark(null);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== deletingBookmark.id));
      setSelectedTagId('');
      setOperationNotice('Bookmark deleted.');
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setDeleteError(requestError.message || 'Could not delete the bookmark. Try again.');
    } finally {
      setDeleteSaving(false);
    }
  }

  async function toggleFavorite(bookmark) {
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !bookmark.favorite }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not update favorite status.');
      setBookmarks((current) => current.map((item) => (item.id === bookmark.id ? result.bookmark : item)));
    } catch (favoriteError) {
      setOperationNotice(favoriteError.message || 'Could not update favorite status. Try again.');
    }
  }

  async function checkLink(bookmark) {
    setLinkChecks((current) => ({ ...current, [bookmark.id]: { status: 'checking' } }));
    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}/check-link`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not check this link.');
      setLinkChecks((current) => ({
        ...current,
        [bookmark.id]: { status: result.reachable ? 'reachable' : 'unreachable', message: result.message },
      }));
    } catch (checkError) {
      setLinkChecks((current) => ({
        ...current,
        [bookmark.id]: { status: 'error', message: checkError.message || 'Could not check this link.' },
      }));
    }
  }

  async function handleExport() {
    setOperationNotice('');
    try {
      const response = await fetch('/api/bookmarks');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not export bookmarks.');

      const payload = {
        exportedAt: new Date().toISOString(),
        bookmarks: result.bookmarks.map((bookmark) => ({
          url: bookmark.url,
          title: bookmark.title,
          tags: (bookmark.tags ?? []).map((tag) => tag.name),
          favorite: Boolean(bookmark.favorite),
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `pinboard-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setOperationNotice(`Exported ${payload.bookmarks.length} bookmark${payload.bookmarks.length === 1 ? '' : 's'} to a JSON file.`);
    } catch (exportError) {
      setOperationNotice(exportError.message || 'Could not export bookmarks. Try again.');
    }
  }

  function triggerImport() {
    importInputRef.current?.click();
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setOperationNotice('');
    try {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      const entries = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.bookmarks)
          ? payload.bookmarks
          : null;
      if (!entries) throw new Error('Expected a JSON array of bookmarks, or an export file with a "bookmarks" array.');

      let created = 0;
      let duplicates = 0;
      let invalid = 0;
      for (const entry of entries) {
        if (!entry || typeof entry.url !== 'string') {
          invalid += 1;
          continue;
        }
        try {
          const importResponse = await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: entry.url,
              title: typeof entry.title === 'string' ? entry.title : '',
              tags: Array.isArray(entry.tags) ? entry.tags : typeof entry.tags === 'string' ? entry.tags.split(',') : [],
            }),
          });
          if (importResponse.status === 201) created += 1;
          else if (importResponse.status === 409) duplicates += 1;
          else invalid += 1;
        } catch {
          invalid += 1;
        }
      }

      setOperationNotice(`Import finished: ${created} added, ${duplicates} already saved, ${invalid} skipped.`);
      setRefreshKey((current) => current + 1);
    } catch (importError) {
      setOperationNotice(importError.message || 'Could not import that file. Try again.');
    } finally {
      setImporting(false);
    }
  }

  const savedTitle = savedBookmark?.bookmark.title || hostnameFromUrl(savedBookmark?.bookmark.url ?? '');
  const selectedTag = availableTags.find((tag) => String(tag.id) === selectedTagId);
  const hasActiveFilters = Boolean(selectedTagId || searchTerm || favoriteOnly);

  return (
    <main className="app-shell">
      <a className="skip-link" href="#add-bookmark-title">Skip to main content</a>
      <datalist id="tag-suggestions">
        {availableTags.map((tag) => <option value={tag.name} key={tag.id} />)}
      </datalist>
      <div className="page-content" inert={Boolean(activeDialogType)}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pinboard home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>pinboard<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-status-group">
          <button
            className="theme-toggle-button"
            type="button"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-pressed={theme === 'dark'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className={`connection-status connection-status--${apiStatus}`} role="status">
            <span className="status-dot" />
            {apiStatus === 'checking' ? 'Connecting locally' : apiStatus === 'connected' ? 'Local storage ready' : 'API unavailable'}
          </div>
          {apiStatus === 'unavailable' && (
            <button className="retry-connection-button" type="button" onClick={() => setHealthRetryKey((current) => current + 1)}>
              Retry
            </button>
          )}
        </div>
      </header>

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL LIBRARY</div>
        <h1 id="welcome-title">A calmer place for<br /><span>the things you find.</span></h1>
        <p className="welcome-copy">
          Save useful corners of the internet, add a little structure, and find them again when it matters.
        </p>
        <div className="welcome-meta">
          <span className="meta-icon" aria-hidden="true">⌂</span>
          Everything stays on this device
        </div>
      </section>

      <section className="workspace" aria-labelledby="add-bookmark-title">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">START COLLECTING</p>
            <h2 id="add-bookmark-title">Add a bookmark</h2>
          </div>
          <span className="sort-label"><span aria-hidden="true">↗</span> Saved locally</span>
        </div>

        <form className="bookmark-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="bookmark-url">Website URL <span>Required</span></label>
          <input
            id="bookmark-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.com/article"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setUrlError(''); setError(''); setDuplicateBookmark(null); }}
            maxLength={2048}
            required
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? 'bookmark-url-error' : undefined}
          />
          {urlError && <p className="field-error" id="bookmark-url-error" role="alert">{urlError}</p>}

          <label className="field-label title-label" htmlFor="bookmark-title">Title <span>Optional</span></label>
          <input
            id="bookmark-title"
            name="title"
            type="text"
            placeholder="Give this page a name"
            value={title}
            onChange={(event) => { setTitle(event.target.value); setTitleError(''); setError(''); }}
            maxLength={300}
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? 'bookmark-title-error' : undefined}
          />
          {titleError && <p className="field-error" id="bookmark-title-error" role="alert">{titleError}</p>}
          <p className="field-hint">Leave the title blank and Pinboard will try to get it from the page.</p>

          <label className="field-label tags-label" htmlFor="bookmark-tags">Tags <span>Optional</span></label>
          <input
            id="bookmark-tags"
            name="tags"
            type="text"
            placeholder="research, design, reading"
            value={tagsInput}
            onChange={(event) => { setTagsInput(event.target.value); setTagsError(''); setError(''); }}
            maxLength={1000}
            list="tag-suggestions"
            aria-invalid={Boolean(tagsError)}
            aria-describedby={tagsError ? 'bookmark-tags-error' : 'bookmark-tags-hint'}
          />
          {tagsError && <p className="field-error" id="bookmark-tags-error" role="alert">{tagsError}</p>}
          <p className="field-hint" id="bookmark-tags-hint">Separate tags with commas. Up to 20 tags, 40 characters each; repeats are combined.</p>

          {error && <p className="form-message form-message--error" role="alert">{error}</p>}
          {duplicateBookmark && (
            <div className="duplicate-notice" role="status">
              <span>Already in your collection:</span>
              <a href={duplicateBookmark.url} target="_blank" rel="noopener noreferrer">
                {duplicateBookmark.title || hostnameFromUrl(duplicateBookmark.url)}
              </a>
              <button type="button" onClick={() => { beginEdit(duplicateBookmark); setDuplicateBookmark(null); }}>
                Edit existing
              </button>
            </div>
          )}

          <button className="submit-button" type="submit" disabled={submitting || apiStatus !== 'connected'}>
            {submitting ? <><span className="button-spinner" /> Saving bookmark…</> : <><span aria-hidden="true">＋</span> Save bookmark</>}
          </button>
        </form>

        {savedBookmark && (
          <div className={`save-result ${savedBookmark.titleStatus === 'unavailable' ? 'save-result--notice' : ''}`} role="status" aria-live="polite">
            <div className="result-check" aria-hidden="true">✓</div>
            <div className="result-copy">
              <strong>Bookmark saved</strong>
              <a href={savedBookmark.bookmark.url} target="_blank" rel="noopener noreferrer">{savedTitle}</a>
              {savedBookmark.titleStatus === 'unavailable' && <span>We couldn't retrieve a page title, but saved the URL.</span>}
              {savedBookmark.bookmark.tags?.length > 0 && (
                <span className="result-tags">
                  {savedBookmark.bookmark.tags.map((tag) => <span className="tag-chip" key={tag.id}>{tag.name}</span>)}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="bookmark-collection" aria-labelledby="bookmark-list-title">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">YOUR COLLECTION</p>
            <h2 id="bookmark-list-title" ref={collectionHeadingRef} tabIndex={-1}>Bookmarks <span className="count-pill">{bookmarks.length}</span></h2>
          </div>
          <div className="list-controls">
            <label className="favorite-filter" htmlFor="favorite-filter">
              <input
                id="favorite-filter"
                type="checkbox"
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              />
              ★ Favorites only
            </label>
            <label htmlFor="tag-filter">Filter by tag</label>
            <select
              id="tag-filter"
              value={selectedTagId}
              onChange={(event) => setSelectedTagId(event.target.value)}
              disabled={tagsLoading || tagFilterError || availableTags.length === 0}
            >
              <option value="">All bookmarks</option>
              {availableTags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}
            </select>
            <span className="sort-label"><span aria-hidden="true">↕</span> Newest first</span>
            <button className="collection-tool-button" type="button" onClick={handleExport}>
              Export
            </button>
            <button className="collection-tool-button" type="button" onClick={triggerImport} disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <input
              ref={importInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json"
              aria-label="Import bookmarks from a JSON file"
              onChange={handleImportFile}
            />
          </div>
        </div>

        {apiError && <p className="connection-error" role="alert">{apiError}</p>}
        {tagsLoading && <p className="filter-loading" role="status">Loading available tags…</p>}
        {tagFilterError && (
          <div className="filter-error" role="alert">
            <span>Tag filtering is temporarily unavailable: {tagFilterError}</span>
            <button type="button" onClick={() => setTagsRetryKey((current) => current + 1)}>Retry tags</button>
          </div>
        )}
        {operationNotice && <p className="operation-notice" role="status">{operationNotice}</p>}

        <div className="search-row">
          <label className="visually-hidden" htmlFor="bookmark-search">Search bookmarks by title or URL</label>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            id="bookmark-search"
            type="search"
            placeholder="Search titles or URLs…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={200}
            aria-describedby="bookmark-search-hint"
          />
          {searchInput && (
            <button className="clear-search-button" type="button" onClick={() => setSearchInput('')} aria-label="Clear search">
              Clear
            </button>
          )}
          <span className="visually-hidden" id="bookmark-search-hint">Search matches partial text in bookmark titles and URLs and can be combined with the tag filter.</span>
        </div>

        {bookmarksError && (
          <div className="list-error" role="alert">
            <span>{bookmarksError}</span>
            <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Try again</button>
          </div>
        )}

        {bookmarksLoading && bookmarks.length === 0 && !bookmarksError && (
          <p className="list-loading" role="status">Loading your saved bookmarks…</p>
        )}

        {bookmarksLoading && bookmarks.length > 0 && !bookmarksError && (
          <p className="list-loading" role="status">Updating bookmarks…</p>
        )}

        {!bookmarksLoading && !bookmarksError && bookmarks.length === 0 && (
          <div className="list-empty" role="status">
            <span className="list-empty-icon" aria-hidden="true">↗</span>
            <strong>{hasActiveFilters ? 'No bookmarks match these filters' : 'No bookmarks yet'}</strong>
            <span>
              {hasActiveFilters
                ? `Nothing matches${searchTerm ? ` “${searchTerm}”` : ''}${selectedTag ? ` in “${selectedTag.name}”` : ''}${favoriteOnly ? ' among your favorites' : ''}. Try a different search, tag, or filter.`
                : 'Save a URL above and it will appear here.'}
            </span>
            {hasActiveFilters && (
              <button className="clear-filter-button" type="button" onClick={() => { setSelectedTagId(''); setSearchInput(''); setFavoriteOnly(false); }}>
                Clear search, tag, and favorites filter
              </button>
            )}
          </div>
        )}

        {bookmarks.length > 0 && (
          <ol className="bookmark-list" aria-label="Saved bookmarks, newest first">
            {bookmarks.map((bookmark) => {
              const displayTitle = bookmark.title || hostnameFromUrl(bookmark.url);
              const linkCheck = linkChecks[bookmark.id];
              return (
                <li className="bookmark-list-item" key={bookmark.id}>
                  <article className="bookmark-card">
                    <button
                      className={`favorite-toggle-button${bookmark.favorite ? ' is-favorite' : ''}`}
                      type="button"
                      onClick={() => toggleFavorite(bookmark)}
                      aria-pressed={bookmark.favorite}
                      aria-label={bookmark.favorite ? `Remove ${displayTitle} from favorites` : `Add ${displayTitle} to favorites`}
                    >
                      <span aria-hidden="true">{bookmark.favorite ? '★' : '☆'}</span>
                    </button>
                    <span className="bookmark-card-icon" aria-hidden="true">↗</span>
                    <div className="bookmark-card-copy">
                      <span className="bookmark-card-domain">{hostnameFromUrl(bookmark.url)}</span>
                      <a href={bookmark.url} target="_blank" rel="noopener noreferrer">{displayTitle}</a>
                      <span className="bookmark-card-url">{bookmark.url}</span>
                      {bookmark.tags?.length > 0 && (
                        <span className="bookmark-tags" aria-label="Tags">
                          {bookmark.tags.map((tag) => <span className="tag-chip" key={tag.id}>{tag.name}</span>)}
                        </span>
                      )}
                      {linkCheck && (
                        <span className={`link-check-status link-check-status--${linkCheck.status}`} role="status" aria-live="polite">
                          {linkCheck.status === 'checking' && 'Checking link…'}
                          {linkCheck.status === 'reachable' && 'Link is reachable'}
                          {linkCheck.status === 'unreachable' && (linkCheck.message || 'Link may be broken')}
                          {linkCheck.status === 'error' && (linkCheck.message || 'Could not check this link')}
                        </span>
                      )}
                    </div>
                    <time className="bookmark-card-date" dateTime={bookmark.createdAt}>{formatSavedAt(bookmark.createdAt)}</time>
                    <button
                      className="check-link-button"
                      type="button"
                      onClick={() => checkLink(bookmark)}
                      disabled={linkCheck?.status === 'checking'}
                      aria-label={`Check whether the link for ${displayTitle} still works`}
                    >
                      {linkCheck?.status === 'checking' ? 'Checking…' : 'Check link'}
                    </button>
                    <button className="edit-bookmark-button" type="button" onClick={() => beginEdit(bookmark)} aria-label={`Edit ${displayTitle}`}>
                      Edit
                    </button>
                    <button className="delete-bookmark-button" type="button" onClick={(event) => { focusReturnRef.current = event.currentTarget; setDeletingBookmark(bookmark); setDeleteError(''); setOperationNotice(''); }} aria-label={`Delete ${displayTitle}`}>
                      Delete
                    </button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      </div>

      {editingBookmark && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !editSaving) closeEdit(); }}>
          <section className="edit-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-bookmark-heading">
            <div className="edit-modal-heading">
              <div>
                <p className="section-kicker">UPDATE YOUR COLLECTION</p>
                <h2 id="edit-bookmark-heading">Edit bookmark</h2>
              </div>
              <button className="modal-close-button" type="button" onClick={closeEdit} disabled={editSaving} aria-label="Close edit dialog">×</button>
            </div>
            <form className="bookmark-form edit-form" onSubmit={handleEditSubmit}>
              <label className="field-label" htmlFor="edit-bookmark-url">Website URL <span>Required</span></label>
              <input
                id="edit-bookmark-url"
                type="text"
                data-dialog-initial-focus
                value={editingBookmark.url}
                onChange={(event) => { setEditingBookmark((current) => ({ ...current, url: event.target.value })); setUrlError(''); setEditError(''); setEditDuplicateBookmark(null); }}
                maxLength={2048}
                required
                aria-invalid={Boolean(urlError)}
                aria-describedby={urlError ? 'edit-bookmark-url-error' : undefined}
              />
              {urlError && <p className="field-error" id="edit-bookmark-url-error" role="alert">{urlError}</p>}
              <label className="field-label title-label" htmlFor="edit-bookmark-title">Title <span>Optional</span></label>
              <input
                id="edit-bookmark-title"
                type="text"
                value={editingBookmark.title}
                onChange={(event) => { setEditingBookmark((current) => ({ ...current, title: event.target.value })); setTitleError(''); setEditError(''); }}
                maxLength={300}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? 'edit-bookmark-title-error' : undefined}
              />
              {titleError && <p className="field-error" id="edit-bookmark-title-error" role="alert">{titleError}</p>}
              <p className="field-hint">Leave blank to clear the title, or change the URL to attempt a fresh page title.</p>
              <label className="field-label tags-label" htmlFor="edit-bookmark-tags">Tags <span>Optional</span></label>
              <input
                id="edit-bookmark-tags"
                type="text"
                value={editingBookmark.tags}
                onChange={(event) => { setEditingBookmark((current) => ({ ...current, tags: event.target.value })); setTagsError(''); setEditError(''); }}
                maxLength={1000}
                list="tag-suggestions"
                aria-invalid={Boolean(tagsError)}
                aria-describedby={tagsError ? 'edit-bookmark-tags-error' : undefined}
              />
              {tagsError && <p className="field-error" id="edit-bookmark-tags-error" role="alert">{tagsError}</p>}
              <p className="field-hint">Separate tags with commas. Up to 20 tags, 40 characters each.</p>
              {editError && <p className="form-message form-message--error" role="alert">{editError}</p>}
              {editDuplicateBookmark && (
                <div className="duplicate-notice" role="status">
                  <span>Another bookmark already uses this URL:</span>
                  <a href={editDuplicateBookmark.url} target="_blank" rel="noopener noreferrer">
                    {editDuplicateBookmark.title || hostnameFromUrl(editDuplicateBookmark.url)}
                  </a>
                </div>
              )}
              <div className="edit-actions">
                <button className="cancel-edit-button" type="button" onClick={closeEdit} disabled={editSaving}>Cancel</button>
                <button className="submit-button" type="submit" disabled={editSaving}>
                  {editSaving ? <><span className="button-spinner" /> Saving changes…</> : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deletingBookmark && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteSaving) setDeletingBookmark(null); }}>
          <section className="delete-modal" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-bookmark-heading" aria-describedby="delete-bookmark-description">
            <div className="delete-warning-icon" aria-hidden="true">!</div>
            <p className="section-kicker">REMOVE FROM YOUR COLLECTION</p>
            <h2 id="delete-bookmark-heading">Delete this bookmark?</h2>
            <p id="delete-bookmark-description" className="delete-description">
              This will permanently remove <strong>{deletingBookmark.title || hostnameFromUrl(deletingBookmark.url)}</strong> and its tag associations from this device.
            </p>
            <p className="delete-url">{deletingBookmark.url}</p>
            {deleteError && <p className="form-message form-message--error" role="alert">{deleteError}</p>}
            <div className="delete-actions">
              <button className="cancel-edit-button" type="button" data-dialog-initial-focus onClick={() => setDeletingBookmark(null)} disabled={deleteSaving}>Keep bookmark</button>
              <button className="confirm-delete-button" type="button" onClick={handleDeleteConfirm} disabled={deleteSaving}>
                {deleteSaving ? <><span className="button-spinner" /> Deleting…</> : 'Delete bookmark'}
              </button>
            </div>
          </section>
        </div>
      )}

      <footer className="app-footer" inert={Boolean(activeDialogType)}>
        <span>Made for your curious mind.</span>
        <span><span className="footer-lock" aria-hidden="true">▣</span> Local by design</span>
      </footer>
    </main>
  );
}

export default App;
