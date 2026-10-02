## Implementation Plan vs. Actual

**Planned:** implement one requirement at a time, in the order they appear in [docs/01-planning.md](01-planning.md): SQLite schema, add bookmark (with best-effort title lookup), list newest-first, tags, filter by tag, search, edit, delete, input validation, duplicate handling, then empty/error states — running and testing after each step.

**Actual:** built in exactly that order, feature by feature, with a passing test suite and manual/browser checks for the mandatory flows. After the mandatory scope, optional enhancements were added: favorites, JSON import/export, existing-tag suggestions, broken-link checking, responsive controls, a skip link, dark mode, and a schema migration from version 1 to version 2.

**Important deviations:**

- **Validation was tightened after CRUD existed, not before.** Feature 1 shipped with basic HTTP(S)/length checks; Feature 8 later added the full shared client+server validation (hostname shape, whitespace/control characters, 300/40-character limits) once real create/edit usage showed which inputs needed stricter handling. Building loose-but-safe validation first, then hardening it, avoided guessing rules the requirements did not specify.
- **Duplicate detection was sequenced after edit and delete, not before them.** Planning left "same URL" comparison rules as an open question. Implementing duplicate detection (Feature 9) only after the canonical-URL design was settled meant edit/delete did not have to be reworked when normalization rules were finalized.
- **A test-infrastructure defect was found and fixed during the review phase, not during build.** The API test fixture's port-selection logic was flaky (see Troubleshooting); this was not caught until the review pass re-ran the suite, which is later than ideal but is recorded honestly rather than hidden.
- **Optional enhancements were deliberately kept local and incremental.** Favorites use one SQLite flag and an index; import/export uses browser-generated JSON files; tag suggestions reuse `/api/tags`; link checking reuses the existing bounded title-fetch path; dark mode uses a browser local-storage preference. No new service or dependency was introduced.

## Feature Evidence Matrix

| Requirement | Status | How AI helped | What I changed/decided | How I verified |
| --- | --- | --- | --- | --- |
| Add Bookmark | Done | Generated the Express `POST /api/bookmarks` endpoint, the React form, and a bounded/SSRF-safe title fetcher. | Required the fetcher to block loopback/private/reserved addresses and pin resolved DNS results — the first draft did not defend against DNS rebinding. | `npm run test --workspace server` (13 tests at the time); browser smoke test with a supplied title and a blocked-URL fallback case. |
| Tags | Done | Wired tag input into the create form and a transactional tag-normalization routine in SQLite. | Changed the 20-tag limit to count unique nonblank tags instead of raw array length (fixed during review after a boundary-case defect). | `npm run test --workspace server`; browser test entering `Research`, `design`, `RESEARCH` and confirming one merged chip. |
| List/Newest First | Done | Added `GET /api/bookmarks` with `created_at DESC, id DESC` ordering and the React list/empty/loading states. | Kept a stable `id`-based tie-breaker for equal timestamps, since "newest first" alone is not deterministic. | `npm run test --workspace server` newest-first/tie-breaker test; browser showed the empty state with no data. |
| Filter by Tag | Done | Added `GET /api/tags` and a validated `tagId` query parameter on the list endpoint. | Restricted the filter dropdown to tags currently in use, so users cannot select a tag with zero results by construction. | Server tests for matching/unmatched/invalid tag IDs; browser selected a tag and saw only its bookmark. |
| Search | Done | Added a debounced search field and combined it with the tag filter using AND semantics. | Chose case-insensitive JavaScript `toLowerCase()` matching over SQL `LIKE`, so `%`/`_` are literal characters instead of wildcards. | Server tests for title/URL matches, literal wildcards, and combined search+tag filtering; browser no-results check. |
| Edit | Done | Generated `PATCH /api/bookmarks/:id` with partial-update semantics and a pre-filled edit dialog. | Required a title refetch only when the URL changes and no title is supplied, so an unrelated title edit is never silently overwritten. | Server tests for full/partial edits and URL-change title retrieval; browser edited URL, title, and tags on a temporary record. |
| Delete | Done | Added `DELETE /api/bookmarks/:id` with cascading tag cleanup and a confirmation dialog. | Added explicit keyboard focus handling and orphaned-tag cleanup after the code review found both missing. | Server delete/cascade tests; browser confirmed cancel-then-delete behavior and the resulting empty state. |
| Persistence | Done | Suggested reopening a temporary SQLite file to prove data survives a restart. | Added a dedicated test that creates through the HTTP API, closes the server, reopens the same file, and re-lists the record. | `bookmarks remain available through the API after closing and reopening the local server` test; manual restart of `npm run dev`. |
| Validation | Done | Drafted shared client+server rules for URL/title/tag input. | Rejected the first version because it counted blank/duplicate tags before normalizing; fixed to normalize first, then enforce limits. | Client validator tests; server rejection tests for malformed/empty/oversized URLs with no database writes. |
| Duplicate Handling | Done | Implemented canonical-URL comparison (WHATWG `URL` parser) before insert and before URL edits. | Added a second duplicate check inside the write transaction after reasoning through a concurrent-request race the first check alone would miss. | Duplicate-create, duplicate-edit, and concurrent-race tests; browser submitted a case/port-variant URL and saw the existing-record link. |
| Empty/Error States | Done | Reviewed all flows and proposed separate API/list/tag error and retry states. | Disabled bookmark creation until the health check succeeds, so a user cannot submit into a known-broken backend. | Browser checks with mocked 503 responses for health, list, and tags, each showing its own retry control. |

### Optional Enhancement Evidence

| Enhancement | Status | How AI helped | What I changed/decided | How I verified |
| --- | --- | --- | --- | --- |
| Favorites | Implemented | Added the favorite flag, API update/filter behavior, and collection controls. | Used a constrained SQLite `0/1` field, schema version 2 migration, and a favorite-only query filter instead of browser-only state. | Server test `marks and filters favorite bookmarks`; schema default/constraint test; client build succeeded. |
| Import/export | Implemented | Added JSON serialization, download, file selection, validation, and per-entry import counts. | Export includes URL/title/tags/favorite only; import routes records through the normal create API so validation and duplicate handling remain authoritative. | Source inspection and successful production build; no completed browser file-download/file-upload smoke test is claimed yet. |
| Tag suggestions | Implemented | Reused loaded tag data as an HTML `datalist` for create and edit inputs. | Kept suggestions advisory; did not add a second tag-validation path. | Source inspection confirms `datalist` uses `/api/tags` values; existing tag API/validation tests pass. |
| Broken-link checking | Implemented | Added a per-bookmark check action and a server endpoint using the bounded title-fetcher path. | The result is informational only and never deletes or changes a bookmark. | Server test `checks whether a saved link is still reachable` covers reachable, failed, missing-ID, and invalid-ID outcomes. |
| Responsive UI | Implemented | Added mobile wrapping rules for collection controls and bookmark actions. | Preserved the existing 600 px breakpoint and added a 720 px control-wrap breakpoint rather than redesigning the page. | CSS inspection and successful production build; no pixel-by-pixel device benchmark is claimed. |
| Accessibility improvements | Implemented | Added a skip link and accessible labels/pressed states for new controls while retaining modal focus handling. | Kept the background inert during dialogs and made the new controls keyboard reachable. | Source inspection plus existing browser dialog checks; no automated axe or full screen-reader pass was run. |
| Dark mode | Implemented | Added theme variables, a toggle, and local-storage restoration. | Used the existing green visual language with explicit dark-surface overrides; no server persistence was needed for a browser preference. | Source inspection and successful production build; cross-browser visual verification remains limited. |

## Troubleshooting

**Problem 1 — concurrent duplicate creation.** The initial duplicate check ran once, before the (potentially slow) title-fetch step. Reasoning through the timing showed that two near-simultaneous `POST /api/bookmarks` requests for the same canonical URL could both pass that check before either had written a row, creating two records for one URL. Diagnosed by tracing the request flow rather than by an observed failure. Resolved by rechecking for a duplicate a second time inside the SQLite write transaction, so the second request to reach the transaction always sees the first request's row. Verified with a test that pauses one request mid-title-fetch, lets a second request commit, then confirms the first request receives a 409 and the database has exactly one row.

**Problem 2 — intermittent server test failures.** A rerun of the full server suite failed once with `TypeError: fetch failed` / `bad port`, but the same suite had passed moments earlier. Diagnosed from the stack trace, which pointed to Undici's "bad port" check inside `fetch`; the API test fixture was choosing a random port from a range that overlaps ports the Fetch standard blocks. Resolved by asking the OS for a free ephemeral port with a temporary `net.createServer()` probe before binding the real Express server, instead of guessing a random port. Verified at that stage by rerunning the then-current 29-test server suite several times after the change with no further failures; the later enhancement suite has 32 tests.

**Problem 3 (documented, minor) — tag-limit boundary defect.** Twenty valid unique tags plus a trailing blank entry were being rejected because the 20-tag limit was applied to the raw comma-separated list before blank/duplicate entries were removed. Diagnosed during the code review by reading the validator logic side by side with its test. Resolved by normalizing and deduplicating tags before applying the count limit, on both the client and the server. Verified with new boundary tests for 20 unique tags with blanks/duplicates (accepted) and 21 unique tags (rejected).

**Problem 4 — schema migration ordering failure while adding favorites.** The first version of the version-2 migration ran the full schema DDL before adding `favorite`; because `CREATE INDEX ... favorite` requires the column to exist, an existing version-1 database failed with `SQLITE_ERROR`. Diagnosed by running the legacy migration test against a real version-1 database. Resolved by adding the column before rerunning the schema DDL, guarded by a table/column existence check. Retested with the legacy migration and full server suite; both passed.

**Problem 5 — local browser smoke-test startup collision.** A fresh `npm run dev` attempt failed because an older Vite process already owned port 5173; the server also restarted while the stale client was being terminated, producing temporary proxy `ECONNREFUSED` messages. Diagnosed from the terminal output and port ownership. Resolved by stopping the stale 5173/3001 processes and starting one fresh dev process. This was an environment/process issue, not an application defect.

## Significant Human Changes

- **Rejected** a single-check duplicate-detection design in favor of a second check inside the write transaction, because a single pre-check does not close the race between two concurrent create requests (see Troubleshooting, Problem 1).
- **Modified** the tag-limit validator to count unique, nonblank tags instead of raw input length, because the acceptance criteria call for combining duplicates and ignoring blanks, not penalizing a user for them.
- **Modified** the first version of the edit/delete dialogs, which only closed on Escape, into fully focus-trapped modals (Tab/Shift+Tab containment, inert background, focus restoration on close), because a dialog marked `role="dialog"`/`aria-modal="true"` must not leave the page behind it keyboard-reachable.
- **Rejected** a suggestion to store a precomputed "is duplicate" flag on each bookmark row, because that flag could go stale whenever another bookmark's URL changed elsewhere; kept duplicate detection as a query-time comparison against `normalized_url` instead.
- **Modified** the API test fixture's port-selection strategy from a random port guess to an OS-assigned ephemeral port after the intermittent failure in Troubleshooting, Problem 2.
- **Modified** the generated enhancement design to use a schema migration and server-backed favorite state rather than storing favorites only in browser storage, because favorites should survive application restarts and work across the API/UI boundary.
- **Limited** import/export to JSON and normal create requests instead of directly writing imported rows, because this preserves validation and duplicate-handling behavior and makes partial import outcomes visible.

## AI Interactions

### Evidence E-Build-1

**SDLC activity:** build

**Task/feature:** SQLite schema for bookmarks, tags, and bookmark_tags.

**Context given to AI:** The data model and error-handling sections of [docs/02-design.md](02-design.md), and the requirement to support search, filtering, editing, deletion, and persistence.

**Prompt/request:** Generate and implement a SQLite schema for bookmarks, tags, and the bookmark-tag relationship, supporting search, filtering, editing, deletion, and persistence; then run and test it.

**AI response summary:** Produced a versioned schema file with UTC timestamp columns, non-empty checks, unique normalized tag names, cascading foreign keys, and indexes for chronological listing, normalized-URL lookup, and tag filtering, plus a database factory usable from tests.

**Your decision:** Accepted

**What you changed and why:** Used the schema as generated; added a schema-version guard in `server/src/database.js` so a newer schema version cannot silently run against an older one.

**How you verified it:** `npm run test --workspace server` — all 6 schema tests passed (including migration of an earlier scaffold database without losing rows); `npm run build` succeeded; `npm run dev` showed the API/database health status as connected in the browser.

**Outcome:** Worked.

**Iteration:** None needed.

**Approx. time:** 30 minutes.

**Learning:** Asking for tests alongside the schema (not just the schema) meant integrity constraints were exercised immediately instead of only being discovered later.

### Evidence E-Build-2

**SDLC activity:** build

**Task/feature:** Add Bookmark (Feature 1) — API, form, and safe title lookup.

**Context given to AI:** The Add Bookmark acceptance criteria (optional title, graceful title-fetch failure) and the SSRF-related design notes from [docs/02-design.md](02-design.md) (Evidence E-Design-3).

**Prompt/request:** Build Feature 1 in order: add a bookmark, generate its API and UI, test it, and document the work.

**AI response summary:** Implemented `POST /api/bookmarks`, a React URL/title form, and a title fetcher that blocks local/private/reserved IPs, pins DNS results, revalidates redirects, and bounds request time/size.

**Your decision:** Accepted

**What you changed and why:** Kept the SSRF protections as generated; added a loopback Host/Origin check on the API itself (not just the title fetcher) so the local server rejects unexpected origins.

**How you verified it:** `npm run test --workspace server` — 13 tests passed, including blocked-loopback title fetch and untrusted-origin rejection; browser smoke test saved a bookmark with a supplied title and a second with a blocked URL, confirming the fallback notice appeared.

**Outcome:** Worked.

**Iteration:** None for this feature; origin checks were re-verified again in later features.

**Approx. time:** 45 minutes.

**Learning:** Treating "fetch a user-supplied URL from the server" as a security-sensitive feature from the start avoided having to retrofit SSRF protections later.

### Evidence E-Build-3

**SDLC activity:** build

**Task/feature:** List Bookmarks, newest first (Feature 2).

**Context given to AI:** The newest-first listing requirement and the existing `bookmarks` schema with `created_at`/`id` columns.

**Prompt/request:** Build Feature 2: list bookmarks through an API, sort newest first, test the behavior, and document it.

**AI response summary:** Added `GET /api/bookmarks` ordered by `created_at DESC, id DESC` and a React list with loading/empty/retryable-error states.

**Your decision:** Accepted

**What you changed and why:** Kept the `id` tie-breaker as generated, since "most recent first" alone does not define order for two bookmarks created in the same millisecond.

**How you verified it:** `npm run test --workspace server` — 14 tests passed, including an explicit tie-breaker case; browser showed the empty-list message with no data.

**Outcome:** Worked.

**Iteration:** None.

**Approx. time:** 20 minutes.

**Learning:** Explicitly testing the tie-breaker case caught an ordering rule the plain English requirement did not spell out.

### Evidence E-Build-4

**SDLC activity:** build

**Task/feature:** Tag Bookmarks (Feature 3).

**Context given to AI:** The tagging acceptance criteria (one or more tags, sensible duplicate handling) and the existing `tags`/`bookmark_tags` schema.

**Prompt/request:** Implement Feature 3: add tagging support.

**AI response summary:** Connected a comma-separated tag field to the create form, and added server-side trimming, whitespace collapsing, and case-insensitive deduplication inside one SQLite transaction per bookmark.

**Your decision:** Modified

**What you changed and why:** The first version capped tags at 20 raw entries before removing blanks/duplicates; changed it to normalize and deduplicate first, then cap at 20 unique tags (this specific defect was only fully caught later, in review — see Troubleshooting, Problem 3).

**How you verified it:** `npm run test --workspace server` — 16 tests passed at the time, including case-insensitive merge/reuse; browser test submitting `Research`, `design`, `RESEARCH` showed one merged `Research` chip.

**Outcome:** Partially worked at first (the boundary bug was still present) — fully worked after the review-stage fix.

**Iteration:** Revisited during the code review to fix the boundary counting defect.

**Approx. time:** 40 minutes.

**Learning:** "It passes the tests I wrote" is not the same as "it is correct" — the missing boundary case only surfaced when a dedicated review asked "what if tags are blank or duplicated near the limit?"

### Evidence E-Build-5

**SDLC activity:** build

**Task/feature:** Filter by Tag (Feature 4).

**Context given to AI:** The filter-by-tag acceptance criteria and the existing tag-listing endpoint.

**Prompt/request:** Implement Feature 4: filter bookmarks by a selected tag.

**AI response summary:** Added `GET /api/tags` for filter choices and a validated `tagId` query parameter on `GET /api/bookmarks`, plus a React selector.

**Your decision:** Accepted

**What you changed and why:** Restricted the tag dropdown to tags currently assigned to at least one bookmark, so the UI cannot offer a filter that is guaranteed to show nothing.

**How you verified it:** Server tests for matching/unmatched/invalid `tagId`; browser test selecting the "Research" tag and confirming only that bookmark appeared.

**Outcome:** Worked.

**Iteration:** None.

**Approx. time:** 25 minutes.

**Learning:** Constraining the available filter options at the API layer (not just hiding them in the UI) kept the invariant enforced even if the UI changed later.

### Evidence E-Build-6

**SDLC activity:** build

**Task/feature:** Search by title or URL (Feature 5).

**Context given to AI:** The search acceptance criteria (title or URL, understandable no-results state) and the existing tag-filter query parameter.

**Prompt/request:** Implement Feature 5: search bookmarks by title or URL.

**AI response summary:** Added a `q` query parameter, an initial SQL `LIKE`-based match, and a debounced React search field combined with the tag filter.

**Your decision:** Modified

**What you changed and why:** Replaced the SQL `LIKE` approach with in-process JavaScript `toLowerCase()` substring matching, so `%` and `_` in a search term are treated as literal characters instead of SQL wildcards, and so case-insensitivity does not depend on SQLite's ASCII-only `lower()`.

**How you verified it:** `npm run test --workspace server` — 18 tests passed, including literal-wildcard search and combined search+tag filtering; browser test with a non-matching search term showed the dedicated no-results message.

**Outcome:** Worked.

**Iteration:** None further at this stage; Unicode search correctness was re-checked later during the code review.

**Approx. time:** 30 minutes.

**Learning:** A generated SQL-based search looked correct until literal `%`/`_` characters were tested — a reminder to test the exact edge cases named in the requirements (search text containing wildcard-like characters).

### Evidence E-Build-7

**SDLC activity:** build

**Task/feature:** Edit Bookmark (Feature 6).

**Context given to AI:** The edit acceptance criteria (change URL/title/tags, partial updates preserve other fields, title refetch on URL change).

**Prompt/request:** Implement Feature 6: edit a saved bookmark's URL, title, or tags.

**AI response summary:** Added `PATCH /api/bookmarks/:id` with partial-update semantics, transactional tag replacement, and a pre-filled React edit dialog.

**Your decision:** Accepted

**What you changed and why:** Kept the rule that a title refetch is attempted only when the URL changes and no title is supplied, so editing only the tags never silently overwrites an existing title.

**How you verified it:** Server tests for full/partial edits, URL-change title retrieval, and rejected invalid edits; browser test edited a temporary bookmark's URL, title, and tags and confirmed the updated card, then removed the test data.

**Outcome:** Worked.

**Iteration:** None.

**Approx. time:** 40 minutes.

**Learning:** Partial-update endpoints need an explicit "field present vs. field omitted" distinction (not just "field is falsy"), otherwise clearing a title and not touching it become indistinguishable.

### Evidence E-Build-8

**SDLC activity:** build

**Task/feature:** Delete Bookmark with an accidental-deletion safeguard (Feature 7).

**Context given to AI:** The delete acceptance criteria (confirmation/safeguard against accidental deletion) and the cascading foreign keys in the schema.

**Prompt/request:** Implement Feature 7: delete bookmarks.

**AI response summary:** Added `DELETE /api/bookmarks/:id` using the foreign-key cascade for bookmark-tag rows, plus a confirmation dialog with a cancel option.

**Your decision:** Modified

**What you changed and why:** The first dialog only closed on Escape; added explicit initial focus on "Keep bookmark," full keyboard containment, and orphaned-tag cleanup (the initial version left now-unused tag rows behind), because both were needed for the safeguard to be genuinely safe and complete.

**How you verified it:** Server tests for cascade behavior, shared-tag retention, and orphan-tag cleanup; browser test cancelled once (record retained), then confirmed deletion and observed the empty-list state.

**Outcome:** Partially worked at first (focus handling and tag cleanup were later review fixes) — fully worked after those fixes.

**Iteration:** Revisited during the code review for the focus-trap and orphan-tag issues.

**Approx. time:** 35 minutes.

**Learning:** "Has a confirmation dialog" and "is an accessible, safe confirmation dialog" are different bars — the second needs explicit keyboard-focus testing, not just a visual check.

### Evidence E-Build-9

**SDLC activity:** build

**Task/feature:** Validation of URL, title, and tag input (Feature 8).

**Context given to AI:** The validation acceptance criteria (reject empty/invalid URLs with understandable feedback) and the existing create/edit endpoints.

**Prompt/request:** Implement Feature 8: validate bookmark inputs and provide understandable feedback.

**AI response summary:** Tightened shared URL validation (HTTP/HTTPS only, 2,048-character limit, hostname shape, no credentials/whitespace/control characters), added client-side validators mirroring the server rules, and wired field-level errors into both forms.

**Your decision:** Accepted, with a later correction

**What you changed and why:** Accepted the validation rules as generated; the tag-limit counting defect in this same validator was only caught during the subsequent code review (see Troubleshooting, Problem 3) and fixed then.

**How you verified it:** `npm run test --workspace client` — 4 validator tests passed; `npm run test --workspace server` — 24 tests passed, including malformed/empty/oversized URL rejection with no database writes; browser test submitted an FTP URL and saw the inline HTTP/HTTPS error.

**Outcome:** Worked for URL/title rules; the tag-count edge case needed a follow-up fix.

**Iteration:** Revisited during the code review for the tag-limit boundary fix.

**Approx. time:** 40 minutes.

**Learning:** Shared client+server validation logic reduces duplication, but any defect in it is duplicated too — worth extra scrutiny on shared validators specifically.

### Evidence E-Build-10

**SDLC activity:** build

**Task/feature:** Duplicate URL detection on create and edit (Feature 9).

**Context given to AI:** The duplicate-handling acceptance criteria and the canonical-URL design notes in [docs/02-design.md](02-design.md).

**Prompt/request:** Implement Feature 9: detect duplicate bookmarks.

**AI response summary:** Added a canonical-URL comparison (via the WHATWG `URL` parser) checked once before insert/update, returning HTTP 409 with the existing bookmark's details.

**Your decision:** Modified

**What you changed and why:** A single pre-check left a race window for two concurrent create requests targeting the same URL (see Troubleshooting, Problem 1); added a second duplicate check inside the write transaction so the check and the write are atomic.

**How you verified it:** `npm run test --workspace server` — 27 tests passed, including a dedicated concurrent-race test, duplicate-edit rejection, and an allowed same-record self-update; browser test submitted a case/port-variant URL and saw the existing-bookmark link with the saved count unchanged.

**Outcome:** Partially worked at first (race condition) — fully worked after the transactional recheck.

**Iteration:** Added the race test only after reasoning through the timing window; then fixed and reverified.

**Approx. time:** 45 minutes.

**Learning:** "Check before you fetch" is not the same as "check right before you write" — anything with an `await` between a check and a write needs a second check after the `await`.

### Evidence E-Build-11

**SDLC activity:** build

**Task/feature:** Empty/Error States across all flows (Feature 10).

**Context given to AI:** The empty/error-state acceptance criteria (no bookmarks, no search results, title-fetch failure, invalid input, all handled in a user-friendly way).

**Prompt/request:** Implement Feature 10: ensure empty and error states are handled clearly throughout the Bookmark Manager.

**AI response summary:** Reviewed every flow and proposed separating API-health, bookmark-list, and tag-load failures into independent states with their own retry actions, plus operation feedback for edits whose title lookup fails and for successful deletions.

**Your decision:** Accepted

**What you changed and why:** Also disabled the "Save bookmark" button until the health check succeeds, so the UI cannot let a user submit into a backend already known to be unreachable.

**How you verified it:** `npm run test --workspace client` (4) and `npm run test --workspace server` (27) both passed; browser checks with the health/list/tags endpoints temporarily mocked as unavailable showed three independent retry controls, and removing the mocks and retrying returned the app to its normal empty state with no leftover test data.

**Outcome:** Worked.

**Iteration:** None further at this stage.

**Approx. time:** 35 minutes.

**Learning:** Mocking each backend endpoint as unavailable one at a time (rather than all at once) was the only way to confirm the UI actually distinguishes the three failure sources instead of showing one generic error.

### Evidence E-Build-12

**SDLC activity:** build

**Task/feature:** Implement the optional enhancements after the mandatory requirements were complete.

**Context given to AI:** The assignment's optional-enhancement list and the completed React/Express/SQLite bookmark manager, including its versioned schema, existing tag API, title-fetch security controls, and modal accessibility behavior.

**Prompt/request:** Add useful optional enhancements without weakening the mandatory behavior: favorites, import/export, tag suggestions, broken-link checking, responsive/accessibility improvements, and dark mode.

**AI response summary:** Added a version-2 SQLite favorite flag and migration, favorite API/filter/UI behavior, JSON import/export, tag-name datalist suggestions, a best-effort link-check endpoint and UI action, a persisted theme toggle, a skip link, and responsive control wrapping.

**Your decision:** Modified

**What you changed and why:** Kept import/export JSON-only and routed imports through `POST /api/bookmarks`; made broken-link checks informational; stored favorites in SQLite rather than only local storage; and fixed the first migration ordering defect before accepting the enhancement set.

**How you verified it:** Added and passed server tests for favorite defaults/constraints, favorite filtering/update, link-check reachable/failed/missing/invalid cases, and version-1 migration. Ran the client test suite and production build. Source inspection confirmed the new controls have accessible names and the theme preference uses local storage.

**Outcome:** Worked after migration rework; optional backend behavior is covered by automated tests. Browser file import/export, theme visuals, and all enhancement flows have not been fully smoke-tested in this session.

**Iteration:** One migration fix: add `favorite` before running the schema DDL that creates its index.

**Approx. time:** 90 minutes.

**Learning:** Optional features still need to respect the original ownership boundaries: persistence belongs in SQLite, validation belongs on the server, and browser conveniences should not become alternate business rules.

## Local Run Evidence

The application was run locally with `npm run dev` (a local Express API on `127.0.0.1:3001` plus a React dev server on `127.0.0.1:5173`) and, separately, as a production build served by the same local Express server after `npm run build`. Each feature above was exercised in the browser at 127.0.0.1 using only synthetic example.org/example.net URLs, and the connection-status indicator confirmed the local SQLite-backed API was reachable ("Local storage ready") before each check.

Verified end-to-end in the browser: adding a bookmark with and without a title, tagging, newest-first listing, filtering by tag, searching by title and URL, editing a bookmark, cancelling then confirming a deletion, submitting an invalid URL and seeing inline validation, submitting a duplicate URL and seeing the existing-bookmark link, and — for persistence — creating a bookmark, restarting the local server process, and confirming the same bookmark was still listed after reload.

Screenshots were not captured as static image files during this session (verification was performed through live browser interaction and automated checks instead). Before final submission, capture fresh screenshots of these same flows on your machine using only synthetic bookmark data, redact anything personal from the browser chrome, and attach them alongside this file.

For the optional enhancements, the current source and automated checks verify favorite persistence/filtering, link-check API outcomes, schema migration, tag suggestions, JSON import/export handlers, dark-mode preference storage, skip-link markup, and responsive CSS rules. A complete browser walkthrough of export/download, file import, dark-mode appearance, and all new per-card controls remains a manual follow-up; this document does not claim that walkthrough was completed.
