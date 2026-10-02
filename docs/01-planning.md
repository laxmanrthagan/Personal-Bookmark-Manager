## Problem Understanding

The Personal Bookmark Manager is a local, browser-based application for collecting web resources and keeping them organized. A user saves a URL, optionally supplies a title, and can attach tags. The user can later browse recent bookmarks, narrow the list by tag, or search by title or URL. The user can also edit or remove saved bookmarks. Data must persist across application restarts, and invalid URLs must not be stored. If the application attempts to retrieve a title and cannot, it must handle that failure gracefully.

The core value is making saved resources easy to collect, organize, retrieve, and maintain without requiring a paid cloud service or external database.

## Requirement Breakdown

| ID | Capability | Requirement |
| --- | --- | --- |
| R1 | Create | Accept a URL and optional title. If no title is supplied, attempt to retrieve a useful page title and handle retrieval failure gracefully. |
| R2 | Organize | Allow one or more tags to be assigned to a bookmark. |
| R3 | Browse | Display all saved bookmarks with the most recent entries first. |
| R4 | Filter | Allow selection of a tag and display only bookmarks associated with it. |
| R5 | Search | Find bookmarks by title or URL. |
| R6 | Update | Allow the URL, title, or tags of an existing bookmark to be changed. |
| R7 | Delete | Allow removal of a bookmark while providing a reasonable safeguard against accidental deletion. |
| R8 | Persist | Keep bookmarks available after the application is stopped and restarted. |
| R9 | Validate | Reject empty or clearly invalid URLs and show understandable feedback. |
| R10 | Duplicates | Detect or otherwise sensibly handle attempts to save the same URL more than once. |
| R11 | States and errors | Handle an empty bookmark list, no search results, title-retrieval failure, and invalid input in a user-friendly way. |
| R12 | Run locally | Provide a browser-accessible web interface and remain runnable locally. |

The source requirements leave technology selection flexible. The selected assignment stack is React for the frontend, Node.js + Express for the backend, and SQLite for local persistence. No paid cloud service or external database is required, and Docker or deployment is not required for this version.

The mandatory requirements were completed before optional enhancements were added. The optional scope now includes favorites, JSON import/export, tag suggestions from existing tags, broken-link checking, responsive layout improvements, accessibility improvements, and a persisted light/dark theme preference. Related-link search and automatic semantic tag suggestions were not added.

## User Stories & Acceptance Criteria

1. **Save a bookmark:** As a user, I want to save a URL with an optional title so that I can keep a web resource for later.
	- Given a non-empty, valid HTTP or HTTPS URL, when I submit it, then it is saved as a bookmark.
	- Given a title, when I save the bookmark, then that title is associated with it.
	- Given no title, when I save the bookmark, then the application attempts to retrieve a useful page title.
	- Given title retrieval fails, when I save the bookmark, then it is saved without a title, the UI shows a URL/hostname fallback and a non-blocking notice, and no unhandled error occurs.

2. **Tag bookmarks:** As a user, I want to assign one or more tags to a bookmark so that I can organize related resources.
	- Tags are optional when creating a bookmark; when I provide one or more tags, they are associated with that bookmark.
	- Tag labels are trimmed, internal whitespace is collapsed, and duplicate labels are combined without regard to case.
	- Invalid tag values receive understandable feedback and do not create a partial bookmark or tag set.

3. **Browse bookmarks:** As a user, I want to see my saved bookmarks in recency order so that I can find recently added resources quickly.
	- When bookmarks exist, then the list displays all of them with the most recently added first.
	- When no bookmarks exist, then the application presents a user-friendly empty state.

4. **Filter by tag:** As a user, I want to select a tag so that I can view only bookmarks associated with it.
	- When I select a tag, then only bookmarks associated with that tag are shown.

5. **Search bookmarks:** As a user, I want to search by title or URL so that I can find a saved resource.
	- Search is a case-insensitive partial match against the title or URL; surrounding whitespace is ignored.
	- When my search matches a bookmark's title or URL, then that bookmark appears in the results.
	- Search can be combined with a selected tag; matching bookmarks must meet both criteria.
	- When no bookmarks match, then the application presents a user-friendly no-results state and lets me clear search and tag filters.

6. **Edit a bookmark:** As a user, I want to change a saved bookmark's URL, title, or tags so that its information remains current.
	- When I edit any of those fields, then the saved bookmark reflects the changes.
	- When I provide an update for one or more fields, then fields I did not change remain unchanged.
	- When I change the URL and leave the title blank, the application attempts title retrieval and handles failure gracefully.
	- An empty or clearly invalid replacement URL is rejected with understandable feedback.
	- A request to edit a bookmark that no longer exists returns understandable feedback and changes no data.

7. **Delete a bookmark:** As a user, I want to remove a bookmark I no longer need without deleting one accidentally.
	- When I request deletion, then the application provides a reasonable confirmation or other safeguard before removal.
	- I can cancel the confirmation and keep the bookmark, or confirm and remove it.
	- After confirmed removal, the bookmark is no longer present in the saved list.

8. **Retain saved data:** As a user, I want my bookmarks to remain available after restarting the application so that I do not have to recreate them.
	- Given a saved bookmark, when the application is stopped and restarted, then the bookmark remains available.

9. **Handle invalid and duplicate submissions:** As a user, I want clear feedback for invalid URLs and sensible handling of repeated URLs so that the saved list remains useful.
	- When I submit an empty or clearly invalid URL, then it is not saved and understandable feedback is shown.
	- When I attempt to save a URL that is already saved, the application does not create another bookmark and identifies the existing bookmark.
	- Editing a bookmark to a URL already used by another bookmark is rejected with a link to the existing bookmark; keeping its own URL is allowed.

10. **Use the local application:** As a user, I want to open the application in a browser while it runs locally so that I can use it without a required paid cloud service or external database.
	 - The application runs locally and its web interface is accessible through a browser.

## Edge Cases

- The submitted URL is empty or clearly invalid; it must not be saved, and understandable feedback is shown.
- A bookmark has no supplied title and retrieving a useful page title fails; handle the failure gracefully.
- The user submits a URL that is already saved, including a scheme/host-case/default-port variant; reject it as a duplicate and identify the existing bookmark.
- A user edits a bookmark to another bookmark's URL; reject the update without changing the edited bookmark.
- The bookmark list contains no entries; show a user-friendly empty state.
- Tag input contains blank or repeated labels, or more than 20 tags / a tag longer than 40 characters; ignore blanks, combine duplicates, and reject over-limit input without saving.
- A search yields no matching bookmarks; show a user-friendly no-results state.
- Search includes wildcard characters such as `%` or `_`; treat them as literal search text rather than pattern operators.
- Search text is blank after trimming; treat it as no active search. Reject repeated query parameters or input over the configured 200-character limit with clear feedback.
- An edit changes a URL to an empty or clearly invalid value; reject it with understandable feedback.
- An edit supplies malformed tags or references a bookmark that no longer exists; reject the update without partially changing saved data.
- A user initiates deletion unintentionally; provide a reasonable confirmation or other safeguard.
- A deletion is cancelled; keep the bookmark and its tag associations unchanged.
- A bookmark is deleted while its tags are also used by other bookmarks; preserve shared tags and remove unused tag records.
- The application is stopped and restarted; previously saved bookmarks remain available.
- A user marks a bookmark as a favorite, reloads the list, and filters to favorites only; favorite state persists in SQLite.
- A user exports bookmarks to JSON, imports a JSON array or a previous export, and receives counts for added, duplicate, and skipped records.
- A user enters tags and receives suggestions from currently available tag names; suggestions do not bypass server validation.
- A user checks a saved link; a reachable result, an unavailable result, and malformed/missing bookmark IDs receive distinct handling.
- A user switches between light and dark mode; the preference is stored in browser local storage and restored on reload.

## Non-Functional Requirements

- **Performance:** With up to 1,000 bookmarks in SQLite, listing, tag filtering, and search must each return within 500 ms on typical local hardware, using the indexes defined in [docs/02-design.md](02-design.md).
- **Reliability & persistence:** Saved bookmarks and tags must survive an application stop and restart with no data loss for any write that returned a success response; the database file must not require manual repair after a normal restart.
- **Usability & accessibility:** Validation, empty, and error feedback must appear inline without a page reload; all interactive controls (forms, filters, dialogs) must be operable by keyboard alone; normal-size text must meet at least 4.5:1 contrast against its background.
- **Optional usability enhancements:** The main collection layout must remain usable at the existing mobile breakpoint (600 px); the skip link, favorite controls, import/export controls, theme toggle, and link-check controls must expose accessible names and keyboard focus states. These enhancements are verified by source inspection and targeted browser checks where available.
- **Security:** The server must reject any URL scheme other than HTTP/HTTPS, must not allow the title-fetch feature to reach loopback/private/reserved network addresses, and must use parameterized queries for all SQLite access.
- **User interface:** Provide a web-based interface accessible through a browser.
- **Local operation:** The application must run locally and remain runnable on the user's machine.
- **Technology flexibility:** The requirements do not prescribe a stack; the selected design uses React, Node.js + Express, and SQLite.
- **Service constraints:** No paid cloud service or external database is required. Docker and deployment are not required for this version.

## Risks, Assumptions & Questions

**Risks**

- Retrieving a page title depends on access to the target page; network failures, inaccessible pages, or pages without a useful title may prevent retrieval.
- URL validation must reject clearly invalid input without unnecessarily rejecting valid URLs.
- Duplicate detection uses URL-parser canonical forms. Scheme/hostname case and default ports normalize, while distinct paths, query strings, and fragments remain distinct.
- Local persistence can be lost if the chosen storage is cleared or corrupted; the requirements do not specify backup or recovery behavior.

**Assumptions**

- This is a personal, locally run application; accounts, shared collections, and synchronization across devices are not required by the stated requirements.
- A title supplied by the user takes precedence over automatic title retrieval.
- Feature 1 accepts HTTP and HTTPS URLs only, rejects embedded URL credentials and control characters, and limits URL input to 2,048 characters.
- Feature 8 also rejects malformed DNS labels and internal URL whitespace; create and edit forms show field-level feedback before sending invalid URLs to the API.
- Feature 9 compares canonical URL forms for duplicates; it rejects duplicate creation or edits to another bookmark's URL, but allows the bookmark to retain its own URL.
- When no title is supplied or title retrieval fails, Feature 1 saves the bookmark without a retrieved title and shows its hostname as a fallback with a non-blocking notice.
- Tags are optional. Feature 3 accepts up to 20 unique comma-separated labels of at most 40 characters each, trims them, collapses internal whitespace, and deduplicates them case-insensitively; blank and repeated labels do not consume the limit, and the first stored spelling is retained.
- Tag filtering and title/URL search operate on the bookmarks currently saved in the application.
- The requirements specify graceful handling of title-retrieval failure, but do not prescribe the exact fallback behavior or message.

**Questions**

- Are any URL schemes beyond HTTP and HTTPS needed? Feature 1 currently rejects other schemes, credential-bearing URLs, control characters, and URLs longer than 2,048 characters.
- What data recovery expectations are desired? SQLite is the selected persistence mechanism, while backup and recovery behavior remain unspecified.
- Optional import/export is intentionally JSON-only and does not promise conflict resolution beyond duplicate detection, rollback of a partially imported file, or preservation of unknown fields.
- Broken-link checking is best-effort and uses the same bounded title-fetch path; it cannot prove that a link will remain available after the check.

## AI Interactions

### Evidence E-Planning-1

**SDLC activity:** planning

**Task/feature:** Turn the source requirements into the six mandatory planning sections.

**Context given to AI:** The extracted Bookmark Manager requirements (add/tag/list/filter/search/edit/delete/persist/validate/duplicate/empty-error) and an instruction not to generate code.

**Prompt/request:** Analyze the requirements and prepare Problem Understanding, Requirement Breakdown, User Stories & Acceptance Criteria, Edge Cases, Non-Functional Requirements, and Risks/Assumptions/Questions.

**AI response summary:** Organized the requirements into capabilities, drafted 10 user stories with acceptance criteria, and listed edge cases, non-functional targets, risks, assumptions, and open questions.

**Your decision:** Accepted

**What you changed and why:** Kept the structure as the basis for this document; later features resolved several open questions (title-fetch fallback in Feature 1, tag normalization in Feature 3, duplicate URL behavior in Feature 9), and this file was updated each time so it would not disagree with [docs/03-build.md](03-build.md).

**How you verified it:** Cross-checked each user story and edge case against the original requirements text line by line.

**Outcome:** Worked — became the working plan for the rest of the SDLC.

**Iteration:** None needed for this pass; later reviews (E-Planning-2, E-Planning-3) refined it further.

**Approx. time:** 25 minutes.

**Learning:** Asking for all six sections in one structured pass produced a more consistent first draft than asking section by section.

### Evidence E-Planning-2

**SDLC activity:** planning

**Task/feature:** Find missed edge cases, risks, assumptions, and dependencies in the first draft.

**Context given to AI:** The requirement breakdown from E-Planning-1.

**Prompt/request:** Review the requirement breakdown and identify missed edge cases, risks, assumptions, and dependencies.

**AI response summary:** Flagged duplicate URLs introduced while editing, ambiguous/duplicate tags, title-fetch timeout and non-HTML responses, combined search/filter empty states, persistence failures, and ordering ties; raised SSRF risk from fetching arbitrary URLs, untrusted title content, and local data loss.

**Your decision:** Accepted

**What you changed and why:** Added these as edge cases, risks, and open questions rather than new requirements, since the source document did not mandate specific behavior for them.

**How you verified it:** Compared each new item against the source requirements to confirm none contradicted them, then tracked which ones later features resolved.

**Outcome:** Worked — several items became real edge cases in later features (duplicate edit handling in Feature 9, title-fetch SSRF controls in Feature 1).

**Iteration:** Followed up with E-Planning-3 to check story testability.

**Approx. time:** 15 minutes.

**Learning:** A dedicated "what did I miss" pass surfaced risks (SSRF, DNS rebinding) that a single planning pass had not raised.

### Evidence E-Planning-3

**SDLC activity:** planning

**Task/feature:** Check whether the user stories and acceptance criteria were testable.

**Context given to AI:** The user stories and acceptance criteria drafted in E-Planning-1.

**Prompt/request:** Review the user stories and acceptance criteria, identify gaps, and suggest improvements.

**AI response summary:** Found that duplicate handling, tag-filter results, search matching, title-fetch failure outcome, and tie-breaking for equal timestamps were unspecified, so several criteria could not yet be tested pass/fail.

**Your decision:** Modified

**What you changed and why:** Did not immediately rewrite the criteria (the underlying decisions were not yet made); instead recorded these as items to resolve during design/build, then updated the affected stories once Features 1, 3, 4, 5, and 9 defined the actual behavior.

**How you verified it:** Re-read each flagged story after the related feature shipped and confirmed the acceptance criteria matched the implemented behavior and passing tests in [docs/03-build.md](03-build.md).

**Outcome:** Partially worked at the time (useful diagnosis, but fixes were deferred) — fully resolved once the related features landed.

**Iteration:** None further; the plan was left open until implementation settled the questions.

**Approx. time:** 15 minutes.

**Learning:** Testability reviews are most useful early, but some gaps can only be closed once a concrete design decision exists — trying to force premature answers would have meant guessing.

## Planning Outcome

Using AI across three planning passes produced a more complete plan than a single pass would have: it added edge cases (duplicate edits, title-fetch timeouts, tie ordering) that were not in my first reading of the requirements, and it flagged testability gaps in the acceptance criteria before any code existed. The plan was not treated as final — duplicate URL semantics, tag limits, and search matching stayed as open questions until Features 1, 3, 5, and 9 resolved them, and this file was updated each time so the planning record matches the shipped behavior.
