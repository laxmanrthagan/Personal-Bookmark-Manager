# Project Overview

The Personal Bookmark Manager is a locally run, browser-based application for saving web URLs, organizing bookmarks with tags, and finding saved resources through search and filtering.

# Functional Requirements

- **Add bookmarks:** Accept a URL and an optional title. When the title is omitted, attempt to retrieve a useful page title; handle retrieval failure gracefully.
- **Tag bookmarks:** Allow one or more tags to be assigned to a bookmark.
- **List bookmarks:** Show all saved bookmarks, with the most recently added first.
- **Filter by tag:** Let users select a tag and view only bookmarks associated with it.
- **Search bookmarks:** Search saved bookmarks by title or URL.
- **Edit bookmarks:** Allow the URL, title, and tags of an existing bookmark to be changed.
- **Delete bookmarks:** Allow a bookmark to be removed, with a reasonable confirmation or other safeguard against accidental deletion.
- **Persist bookmarks:** Retain saved bookmarks when the application is stopped and restarted.
- **Validate URLs:** Do not save empty or clearly invalid URLs; provide understandable feedback.
- **Handle duplicates:** Detect or otherwise sensibly handle attempts to save the same URL more than once.
- **Present states and errors:** Provide user-friendly handling for an empty bookmark list, no search results, title-retrieval failure, and invalid input.

# Non-Functional Requirements

- The application must provide a web-based user interface accessible through a browser.
- It must run locally and remain runnable on the user's machine.
- User-facing validation and error feedback must be understandable, and failure to retrieve a page title must not prevent graceful handling of the bookmark.

# Technical Constraints

- The technology stack is flexible; choose an appropriate stack.
- No paid cloud service or external database is required.
- Docker and deployment are not required for this version.
- The application must remain runnable on the developer's machine during the evaluation period.

# Acceptance Criteria

- A user can save a valid URL with or without a title; when no title is supplied, the application attempts title retrieval and handles failure without an unhandled error.
- A user can add one or more tags, see all bookmarks newest-first, filter by a tag, and search by title or URL.
- A user can edit a saved bookmark's URL, title, or tags and remove a bookmark with an accidental-deletion safeguard.
- Empty or clearly invalid URLs are rejected with understandable feedback.
- Repeated attempts to save the same URL are detected or handled consistently.
- Bookmarks remain available after stopping and restarting the application.
- Empty-list, no-results, invalid-input, and title-retrieval-failure states are handled in a user-friendly way.
- The application runs locally and its interface can be accessed in a browser.

# Edge Cases

- A URL is empty or clearly invalid.
- A bookmark is submitted without a title, and page-title retrieval fails.
- The submitted URL is already saved.
- The bookmark list is empty.
- A search returns no matching bookmarks.
- A user attempts to delete a bookmark accidentally.
- The application is stopped and restarted, and previously saved bookmarks must still be present.

# Optional Enhancements Implemented

These enhancements are outside the mandatory acceptance criteria and were added only after the core Bookmark Manager behavior was complete:

- Favorites: mark bookmarks as favorites and filter the collection to favorites; favorite state persists in SQLite.
- JSON import/export: export bookmark URL, title, tags, and favorite state; import a JSON array or a prior export with added/duplicate/skipped feedback.
- Automatic tag suggestions: suggest existing tag names through the browser input while retaining server-side validation.
- Broken-link checking: run a best-effort reachability check for a saved bookmark without changing its saved data.
- Responsive UI improvements: wrap collection controls and bookmark actions for smaller viewports.
- Accessibility improvements: keyboard-visible skip link, accessible names and pressed states for enhancement controls, plus the existing modal focus handling and inert background.
- Dark mode: toggle light/dark presentation and restore the preference from browser local storage.

Related-link search was not implemented; it remains outside the current project scope.
