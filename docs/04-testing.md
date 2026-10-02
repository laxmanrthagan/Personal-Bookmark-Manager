# Bookmark Manager Test Matrix

Test matrix coverage is traced to the requirements in [requirements/requirements.md](../requirements/requirements.md). Test results below are based only on executions performed for this workspace.

## Test Strategy

**Automated:**

- Server API/schema tests (`npm run test --workspace server`, Node's built-in test runner) cover every endpoint, SQLite schema constraints, and security-relevant behavior (Host/Origin checks, title-fetch SSRF protections).
- Client validator unit tests (`npm run test --workspace client`, Node's built-in test runner) cover URL/title/tag validation, including boundary and Unicode cases.
- `npm run build` (Vite) is run after each feature as a compile/bundle check.

**Manual:**

- Browser smoke testing (via interactive browser automation against `http://127.0.0.1:5173/`) for flows that are easiest to verify visually: dialog focus/keyboard behavior, empty/no-results states, simulated backend-outage recovery, and color contrast.
- Optional-enhancement checks are split between automated API/schema tests and source/build inspection. Favorites and link checks have endpoint tests; import/export, tag suggestions, dark mode, responsive wrapping, and the skip link have compile/source checks but not a complete automated UI suite.
- Manual configuration inspection for the "no paid cloud service / local-only" constraint, since that is a project-configuration property rather than a runtime behavior.

**Security check on untrusted input:** the server treats every request URL as untrusted. Automated tests confirm the title-fetch feature rejects loopback/private/reserved destinations and blocks HTTPS→HTTP redirect downgrades (`server/test/page-title.test.js` and the SSRF-focused cases in `server/test/bookmarks-api.test.js`), and that the API itself rejects requests from an unexpected Host/Origin. This is the assignment's required check that the application "correctly handles untrusted input" (a URL supplied by the end user that the server then fetches on their behalf).

**Tools:** Node.js built-in test runner (`node:test`) for both workspaces; Vite for the production build check; interactive browser automation for manual UI verification; manual sRGB luminance/contrast-ratio calculations (Node one-liners) for the accessibility contrast check.

**Final automated run:** `npm run test --workspace server` — 32 passed, 0 failed; `npm run test --workspace client` — 4 passed, 0 failed; `npm run build` — succeeded.

## Test Matrix

| ID | Requirement | Scenario | Expected result | Actual result | Pass/Fail | AI-helped (Y/N) |
| --- | --- | --- | --- | --- | --- | --- |
| TM-01 | Add Bookmark | Valid HTTP(S) URL with a supplied title. | One SQLite record is created; title lookup is not called. | Server test `POST /api/bookmarks saves a supplied title without fetching metadata` passed. | Pass | Y |
| TM-02 | Add Bookmark | Valid URL with no title supplied. | Title-fetch service is called and its result is persisted. | Server test `POST /api/bookmarks fetches a title when omitted` (stubbed fetcher) passed. | Pass | Y |
| TM-03 | Empty/Error States | Title-fetch service fails or times out. | Bookmark still saves; title stays null; response indicates the title is unavailable rather than throwing. | Server test `POST /api/bookmarks saves successfully when title retrieval fails` passed; browser fallback check with a blocked loopback URL showed the fallback notice. | Pass | Y |
| TM-04 | Tag Bookmarks | Multiple tags, including whitespace/case duplicates. | Labels merge case-insensitively; normalized tags are reused; tags appear in the response. | Server test `POST /api/bookmarks saves multiple normalized tags and reuses existing tags` passed; browser create/list check confirmed one merged chip. | Pass | Y |
| TM-05 | List Bookmarks (newest first) | List with no records, then with several created at different/equal times. | Empty list returns `[]`; results sort newest first; equal timestamps break ties by descending ID. | Server test `GET /api/bookmarks returns all bookmarks newest first with a stable tie-breaker` passed. | Pass | Y |
| TM-06 | Filter by Tag | Select an assigned tag; select a tag with no bookmarks; send a malformed tag ID. | Matching filter returns only associated bookmarks; unknown valid tag returns none; malformed ID returns 400. | Same server test also asserts `/api/tags`, matching/unmatched filters, and `INVALID_TAG_FILTER`; browser selected "Research" and saw only its bookmark. | Pass | Y |
| TM-07 | Search | Case-insensitive partial title/URL match, Unicode case pairs, literal `%`/`_`, whitespace-only query, over-long/repeated query. | Matches found correctly; wildcard characters treated as literal; malformed queries rejected. | Server tests `GET /api/bookmarks searches titles and URLs case-insensitively and combines tag filters` and `...rejects malformed or excessively long search queries` passed; browser title/URL search and no-results check passed. | Pass | Y |
| TM-08 | Edit Bookmark | Full edit of URL/title/tags; partial edit of one field; URL change with blank title. | Full/partial edits apply correctly; omitted fields are preserved; a URL change with no title triggers a title-fetch attempt. | Server tests `PATCH /api/bookmarks/:id updates URL, title, and tags atomically` and `...supports partial updates...` passed; browser edit of a temporary bookmark showed the updated card. | Pass | Y |
| TM-09 | Validation (edit) | Invalid URL/title/tags on edit; edit of a missing bookmark ID. | Request rejected with an error; no partial data change; missing ID returns 404. | Server test `PATCH /api/bookmarks/:id rejects invalid edits and reports missing records` passed. | Pass | Y |
| TM-10 | Delete Bookmark | Delete a bookmark that shares one tag with another bookmark and has one tag of its own. | Bookmark and its join rows are removed; the shared tag remains; the now-unused tag is removed. | Server test `DELETE /api/bookmarks/:id removes the bookmark, cascades links, and keeps tags still in use` passed. | Pass | Y |
| TM-11 | Delete Bookmark | Malformed ID; already-deleted/missing ID. | Malformed ID returns 400; missing bookmark returns 404. | Server test `DELETE /api/bookmarks/:id validates the ID and reports already-missing bookmarks` passed. | Pass | Y |
| TM-12 | Delete Bookmark (safeguard) | Open delete confirmation, cancel once, then confirm. | Cancel keeps the record; confirming removes it and the list returns to its prior/empty state. | Browser smoke test clicked "Keep bookmark" (record retained), then confirmed deletion (row disappeared). | Pass | N |
| TM-13 | Persistence | Create via the HTTP API, close the server/database, reopen the same SQLite file, list again. | The same bookmark and tags are still present after reopening. | Server test `bookmarks remain available through the API after closing and reopening the local server` passed. | Pass | Y |
| TM-14 | Empty/Error States | No bookmarks exist. | A friendly empty-collection message is shown, not an error. | Browser observed "No bookmarks yet" after test-data cleanup; server empty-list test passed. | Pass | N |
| TM-15 | Empty/Error States | Search or tag filter matches nothing. | A specific no-results message is shown with an action to clear filters. | Browser searched a non-existent term, saw the no-results state, cleared filters, and the list was restored. | Pass | N |
| TM-16 | Validation (URL) | Empty, malformed host, non-HTTP(S) scheme, embedded credentials, internal whitespace/control characters, over-2,048-character URL; trimmed valid HTTP(S)/localhost/bracketed-IPv6 URLs. | Invalid forms are rejected with no saved row; valid forms are accepted. | Client tests `accepts trimmed HTTP and HTTPS URLs` and `rejects empty, malformed, unsafe...` passed; server test `...rejects empty, malformed, credential-bearing, whitespace, and oversized URLs` passed; browser FTP submission showed an inline error and `aria-invalid=true`. | Pass | Y |
| TM-17 | Validation (title/tags) | Title over 300 characters or non-text; tag non-text, more than 20 unique nonblank labels, or a label over 40 characters; blanks/duplicates near the limit. | Invalid values rejected; blanks/duplicates do not consume the tag limit; no partial rows on rejection. | Client tests `validates title length` and `validates optional comma-separated tags...` passed; server tests `rejects invalid schemes and titles` and `rejects malformed tag values without partial inserts` passed. | Pass | Y |
| TM-18 | Duplicate Handling | Case/host-case/default-port alias of an already-saved URL submitted as a new bookmark. | HTTP 409 with the existing bookmark's details; no new record created; no unnecessary title fetch. | Server test `POST /api/bookmarks detects normalized duplicate URLs and returns the existing bookmark` passed; browser submission of a canonical alias showed the existing-bookmark link with the count unchanged. | Pass | Y |
| TM-19 | Duplicate Handling | Two create requests for the same canonical URL, the first paused mid-title-fetch while the second completes. | Only one row is created; the losing request receives 409. | Server test `POST /api/bookmarks rechecks duplicates after async title fetching to prevent a create race` passed. | Pass | Y |
| TM-20 | Duplicate Handling | Edit a bookmark's URL to match another bookmark's canonical URL; edit a bookmark's URL to its own current value. | Editing to another bookmark's URL is rejected with 409 and no mutation; editing to its own URL is allowed. | Server test `PATCH /api/bookmarks/:id rejects URLs used by another bookmark but permits the same bookmark URL` passed. | Pass | Y |
| TM-21 | Non-functional (local operation) | Load the app at `http://127.0.0.1:5173/`. | Page loads; health check reports the local API/database as connected. | Browser loaded the page; API health returned `connected`. | Pass | N |
| TM-22 | Empty/Error States | Simulate a 503 from the health, list, and tag endpoints in turn. | Each failure shows its own message and retry control; recovery restores the healthy state. | Browser route-mocked 503 checks for each endpoint; each retry recovered independently after the mock was removed. | Pass | N |
| TM-23 | Persistence / data integrity | Schema creation, foreign keys, non-empty checks, normalized tag uniqueness, cascade behavior, and migration from an older schema version. | All constraints hold; migration preserves existing rows. | Server tests `schema creates...`, `edits update...`, `persists bookmarks...`, `upgrades the pre-versioned...`, and `enforces non-empty values...` all passed. | Pass | Y |
| TM-24 | Non-functional (local/no-cloud) | Inspect project configuration for hosted-database or paid-service dependencies. | Only local SQLite and local Node/React processes are configured; no cloud database or paid runtime service. | Manual review of `package.json` and the server database configuration; app runs entirely on loopback. | Pass | N |
| TM-25 | Non-functional (accessibility) | Open the edit and delete dialogs; Tab/Shift+Tab through their controls; close them. | Focus moves inside the dialog; background becomes inert; Tab is contained within the dialog; closing restores focus to the invoking control (or a stable fallback). | Browser smoke test verified initial focus, tab-cycle wrap, background inertness, and focus restoration after cancel/close/delete. | Pass | N |
| TM-26 | Non-functional (accessibility) | Measure contrast of secondary/muted text colors against their backgrounds. | Normal-size text meets at least 4.5:1 contrast. | Manual sRGB contrast calculations: `#5f6b63` on white = 5.57:1, on `#f7f8f5` = 5.23:1; `#526b59` on `#eef4ef` = 5.22:1 (sampled palette). | Pass | N |
| TM-27 | Tags (edit hygiene) | Edit a bookmark's tags, removing one that is not used elsewhere and one that is shared with another bookmark. | The now-unused tag row is deleted; the shared tag row is kept. | Server edit-API regression assertion for orphan-tag deletion, plus the delete-API shared-tag-retention test, both passed. | Pass | Y |
| TM-28 | Optional: Favorites | Create a bookmark, mark it favorite, list with `favorite=true`, and send invalid favorite values. | Favorite defaults false; boolean update persists; favorite filter returns only favorites; invalid values are rejected. | Server test `marks and filters favorite bookmarks` and schema test `favorite defaults to false and can be set on insert` passed. | Pass | Y |
| TM-29 | Optional: Broken-link checking | Check a saved bookmark using reachable, failed, missing-ID, and malformed-ID cases. | Endpoint returns a non-mutating reachable/unreachable result; missing and malformed IDs return 404/400. | Server test `checks whether a saved link is still reachable` passed using a stubbed title-fetcher. | Pass | Y |
| TM-30 | Optional: Favorites migration | Open a version-1 SQLite database containing existing bookmark/tag data. | Schema upgrades to version 2, adds favorite=false, preserves existing rows and indexes. | Server test `upgrades the pre-versioned scaffold database without losing rows` passed after fixing migration ordering. | Pass | Y |
| TM-31 | Optional: Tag suggestions | Load existing tags and inspect create/edit tag inputs. | Existing tag names appear as datalist suggestions; normal server validation still applies. | Source inspection confirmed both tag inputs use `list="tag-suggestions"`; client build passed. | Pass | Y |
| TM-32 | Optional: Import/export | Export JSON and import an array or export-shaped object containing bookmarks. | Export contains URL/title/tags/favorite; import reports added/duplicate/skipped counts and sends entries through normal create validation. | Source inspection and production build passed; browser file chooser/download flow was not completed. | Not fully verified | Y |
| TM-33 | Optional: Dark mode | Toggle theme and reload the browser. | Light/dark theme changes and the preference is restored from local storage. | Source inspection confirmed `data-theme` and `pinboard-theme` local-storage behavior; full visual reload check remains pending. | Not fully verified | N |
| TM-34 | Optional: Responsive/accessibility enhancements | Inspect mobile CSS, focus the skip link, and keyboard-reach new controls. | Collection controls wrap at mobile widths; skip link becomes visible on focus; new controls have accessible names/states. | CSS/JSX inspection and production build passed; no full device matrix or axe scan was run. | Partially verified | N |

## AI-Discovered Edge Cases

- **Concurrent duplicate creation** — the AI raised the possibility that two near-simultaneous `POST /api/bookmarks` requests for the same URL could both pass a single pre-write duplicate check; this became TM-19 and the Troubleshooting Problem 1 fix in [docs/03-build.md](03-build.md).
- **Unicode/case-insensitive search correctness** — the AI flagged that SQLite's built-in `lower()` is ASCII-only and could miss accented-character matches; the implementation already used JavaScript `.toLowerCase()` instead, so this was verified as already correct (TM-07) rather than a defect to fix (also recorded as a false positive in [docs/05-review.md](05-review.md)).
- **Canonical URL vs. distinct resource** — the AI pointed out that query strings and fragments must remain significant for duplicate detection (two URLs differing only by path segments are not duplicates, but differing only by default port or hostname case are), which shaped TM-18/TM-20's specific alias and non-alias cases.
- **Tag-limit boundary with blanks/duplicates** — the AI's own generated validator undercounted correctly in most cases but over-rejected right at the 20-tag boundary when blanks or duplicates were present; this edge case was only found by deliberately constructing boundary inputs, and became the TM-17 boundary tests.

## Fail -> Fix -> Retest

**Failure 1 — flaky server test suite (`bad port` fetch error).** A full rerun of `npm run test --workspace server` occasionally failed with `TypeError: fetch failed` / `bad port`, even though the same suite had just passed. **Fix:** the API test fixture was choosing a random port that sometimes fell in a range Undici's `fetch` blocks; changed it to request a free ephemeral port from the OS via a temporary `net.createServer()` probe before starting the real server. **Retest:** reran the then-current server suite multiple times in a row with no further failures (29 passed at that stage; the current suite has 32).

**Failure 2 — valid 20-tag submission rejected.** A manually constructed boundary test (20 unique tags plus a trailing blank) failed validation on both the client and the server. **Fix:** changed both validators to normalize (trim, collapse whitespace, deduplicate case-insensitively, drop blanks) before comparing the count to the 20-tag limit, instead of counting the raw comma-separated list. **Retest:** added and passed new boundary tests for 20 unique tags with blanks/duplicates (accepted) and 21 unique tags (rejected), on both client and server.

**Failure 3 — version-1 favorite migration returned `SQLITE_ERROR`.** Adding the favorite index in the schema before adding the favorite column caused an existing database migration to fail. **Fix:** add the column first when it is missing, then execute the idempotent schema DDL and set `user_version` to 2. **Retest:** the legacy migration test and the full server suite passed; final server result was 32 passed, 0 failed.

## AI Interactions

### Evidence E-Testing-1

**SDLC activity:** testing

**Task/feature:** Design the initial automated test matrix across all ten features.

**Context given to AI:** The full requirement list from [docs/01-planning.md](01-planning.md) and the implemented API/UI from [docs/03-build.md](03-build.md).

**Prompt/request:** Propose a test matrix covering positive, negative, and edge cases for every functional requirement, and identify which scenarios I might have missed.

**AI response summary:** Produced the scenario list that became TM-01 through TM-27, and separately flagged the concurrent-duplicate-create and Unicode-search cases as scenarios not yet covered.

**Your decision:** Accepted

**What you changed and why:** Added the two flagged scenarios as explicit automated tests (TM-19 and the Unicode assertions inside TM-07) rather than leaving them as informal notes.

**How you verified it:** Ran `npm run test --workspace server` and `npm run test --workspace client` after each new test was added and confirmed each new assertion actually failed against a deliberately broken implementation before passing against the fixed one.

**Outcome:** Worked.

**Iteration:** None for the matrix design itself; individual test cases were iterated as bugs were found (see Fail -> Fix -> Retest).

**Approx. time:** 30 minutes.

**Learning:** Asking the AI specifically "what am I missing" after generating a first-pass matrix surfaced two real edge cases (concurrency, Unicode) that a straightforward per-requirement checklist did not.

### Evidence E-Testing-2

**SDLC activity:** testing

**Task/feature:** Diagnose the intermittent `bad port` failure in the server test suite.

**Context given to AI:** The failing stack trace from a rerun of `npm run test --workspace server`, and the test fixture's random-port-selection code.

**Prompt/request:** This test suite passed a minute ago and now fails with `fetch failed` / `bad port` — diagnose why and fix it.

**AI response summary:** Identified that the fixture's random port sometimes landed in the range Node's `fetch` (Undici) refuses to connect to, and proposed requesting an OS-assigned free port via a temporary `net.createServer()` probe instead of guessing.

**Your decision:** Modified

**What you changed and why:** Accepted the OS-assigned-port approach, but corrected an intermediate version of the fix that called `.address()` on the Express `app` object instead of the listening `http.Server` instance, which would have thrown at runtime.

**How you verified it:** Reran the full server suite repeatedly (more than 10 consecutive runs) with no further `bad port` or `EADDRINUSE` failures.

**Outcome:** Worked, after one correction.

**Iteration:** Two iterations — first the port-selection strategy, then the `.address()` target fix.

**Approx. time:** 20 minutes.

**Learning:** A generated fix can be conceptually right but still reference the wrong object; rereading the diff line by line (not just trusting "tests pass now") caught the second bug before it caused a regression.

### Evidence E-Testing-3

**SDLC activity:** testing

**Task/feature:** Investigate a suggested "Unicode search bug" finding.

**Context given to AI:** A code-review pass that raised "SQLite's `lower()` is ASCII-only, so accented-character search may be broken" as a potential defect.

**Prompt/request:** Check whether this is actually a bug in our implementation before I fix anything.

**AI response summary:** On inspection, confirmed the search implementation used JavaScript's `.toLowerCase()` over values already loaded into Node, not SQLite's `lower()` in a query — so the ASCII-only limitation the reviewer described does not apply here.

**Your decision:** Rejected

**What you changed and why:** Did not change the search implementation; the concern was a false positive once the actual code was read, not a real defect.

**How you verified it:** Re-read `server/src/app.js`'s search filtering code, confirmed no SQL `lower()` call exists in the query path, and kept the existing Unicode-case-pair regression test in TM-07 passing as evidence it already worked.

**Outcome:** Worked as-is — no change needed; documented so the same false concern is not re-raised later.

**Iteration:** None.

**Approx. time:** 10 minutes.

**Learning:** AI-raised findings must be checked against the actual code before acting on them; the finding was plausible-sounding but did not match the real implementation.

## Known Limitations

- Title-retrieval success paths are tested against a stubbed fetcher; no automated sweep against arbitrary public websites was run.
- Simulated 503 responses test UI recovery paths only; they are not a substitute for testing against a real degraded backend or network conditions.
- The manual contrast check (TM-26) sampled a representative subset of the updated palette rather than exhaustively checking every color/background pair in the stylesheet.
- No automated accessibility-scanner (e.g., axe) pass was run; dialog accessibility (TM-25) was verified manually.
- Load/performance testing against the NFR target of 1,000 bookmarks / 500 ms was not executed as an automated benchmark in this session; it should be run before relying on that NFR in production.
- Import/export has no browser-level file chooser/download test yet; current coverage is source/build inspection and the import logic is not exercised by client unit tests.
- Dark-mode appearance, local-storage restoration, responsive behavior across a device matrix, and skip-link interaction were not fully browser-tested after the enhancement edits.
- Broken-link tests use a stubbed title-fetcher; no live external-site or long-term link-stability claim is made.
