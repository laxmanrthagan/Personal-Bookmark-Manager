# AI-Assisted SDLC Reflection

## AI Usage Summary

**Most useful:** Build and testing. AI was most valuable when implementing one well-scoped feature at a time (schema, add-bookmark, tags, filter, search, edit, delete, validation, duplicates, empty/error states, then the optional enhancements) and generating the matching automated tests alongside the code. The favorites migration and broken-link endpoint benefited from keeping persistence/security decisions in the existing architecture instead of adding a separate service.

**Least useful / needed the most correction:** Review-stage "defect" claims, test infrastructure, and migration ordering. The claim that SQLite's `lower()` was ASCII-only turned out to be a false positive once the actual code was read (see [docs/05-review.md](05-review.md)). The API test fixture needed two rounds of correction, and the first favorites migration failed because the index was created before its new column. AI-authored migrations and test infrastructure needed the same scrutiny as application code.

## Approximate SDLC Time

| Phase | Approx. time |
| --- | --- |
| Planning | 1 hour |
| Design | 45 minutes |
| Build (all 10 mandatory features + optional enhancements) | 7.5 hours |
| Testing (matrix design, fixture debugging, enhancement tests) | 2 hours |
| Review (findings, fixes, migration rework, reverification) | 2 hours |
| Documentation formatting (this pass) | 1 hour |

These are approximate, based on the number and scope of AI interactions recorded in each phase's evidence log, not a timer-tracked measurement.

## Rework

- **Saved time:** generating the schema, CRUD endpoints, and their tests together (rather than in separate passes) meant most features were exercised by a passing test the same time they were built.
- **Created rework:** the first duplicate-detection implementation needed a second, transactional recheck after reasoning through a concurrency race that a single pre-check missed (see [docs/03-build.md](03-build.md), Troubleshooting Problem 1). The tag-limit validator needed a second pass to normalize before counting. The test fixture needed two corrections before it stopped being flaky. None of these were caught by the AI's own first draft — each needed a human review pass afterward.
- **Net effect:** for this project, AI materially sped up first-draft implementation, but every AI-authored piece of business logic or test infrastructure that touched a boundary condition (counting, concurrency, port selection) needed at least one human-driven correction before it was trustworthy.
- **Optional-enhancement rework:** the first schema-v2 migration failed on an existing database because its new index referenced a column that had not yet been added. The legacy migration test exposed this immediately; reordering the migration fixed it. Import/export and dark mode also made the documentation more careful because implementation/build evidence is stronger than the browser evidence currently available.

## Human Judgment

1. **Rejecting the "SQLite `lower()` is ASCII-only" review finding.** Rather than applying the suggested fix, I re-read the actual query/filter code, confirmed it used JavaScript `.toLowerCase()` (not SQL `lower()`), and kept the existing passing Unicode test as evidence — avoiding an unnecessary change to correct code.
2. **Requiring a second duplicate check inside the write transaction.** The AI's first duplicate-detection design checked once, before the (slow) title fetch; I reasoned through the timing window myself, recognized the concurrent-request race, and required the additional in-transaction check plus a dedicated race test.
3. **Choosing SQLite over JSON files or MongoDB, and keeping optional state in the right layer.** SQLite gave transactional/relational guarantees without an external service; favorites therefore belong in SQLite, while the theme preference belongs in browser local storage and import/export remains a file operation. Splitting the single-file React component was deferred because it carried refactor risk without fixing a confirmed defect.

## What You Would Do Differently

- Ask for a dedicated "what edge cases and boundary conditions am I missing" review immediately after each feature is built, instead of only during a separate later review phase — the tag-limit and orphan-tag defects were both introduced during build and only caught later.
- Require any AI-generated test infrastructure (like the port-selection fixture) to be rerun many times in a row before trusting it, since flakiness by definition does not show up on a single run.
- Write the six documentation files against the assignment's exact mandatory section list and evidence format from the start, instead of using an informal structure and reformatting everything at the end.
- Add browser-level tests for import/export, dark-mode restoration, responsive layout, and the new per-card actions at the same time as the enhancements, rather than relying primarily on source inspection and build success.

## Self-Assessment

**Strongest phase:** Build — the mandatory features and optional backend enhancements are covered by executable tests, and the migration defect was caught before acceptance rather than being hidden.

**Weakest phase:** Enhancement UI verification — import/export file interaction, dark-mode visual restoration, responsive device coverage, and the new controls still need a complete browser pass.

**Confidence in the final submission:** High for the ten mandatory functional requirements and the favorite/link-check backend enhancements (implemented, tested, and reviewed — see the Final Readiness Check in [docs/05-review.md](05-review.md)). Moderate for import/export, dark mode, responsive behavior, and optional UI accessibility because those paths compile and are wired correctly but lack a complete browser automation pass. Lower for the performance NFR (1,000 bookmarks / 500 ms), which was never benchmarked, and for security coverage beyond the specific checks performed (no live external-site sweep was run).

## Demo Video

[Demo video: AI-SDLC-Course-101-Assignment-Laxman-Thagan.mp4](../demo/AI-SDLC-Course-101-Assignment-Laxman-Thagan.mp4)

The recording demonstrates the running Personal Bookmark Manager and covers the mandatory functionality: adding bookmarks with optional titles, assigning tags, listing bookmarks newest-first, filtering by tag, searching by title or URL, editing bookmarks, deleting with confirmation, persistence after restart, URL validation, duplicate handling, title-retrieval fallback, and empty/error states. It also demonstrates the implemented optional enhancements: favorites, JSON import/export, existing-tag suggestions, broken-link checking, responsive/accessibility improvements, and dark mode. The video also includes an AI-assisted development interaction and explains a debugging/rework example from the implementation.

## Declaration

This documentation reflects the actual AI interactions, decisions, fixes, and test runs performed for this assignment in this workspace. Every AI Interaction evidence entry in these six files describes a real prompt and response that occurred during this work, every fix described was applied to the actual source in this repository, and every test result quoted was produced by actually running the corresponding command. No AI interaction, defect, or test result has been invented for the purpose of satisfying the documentation format. The demo video above is explicitly marked as not yet recorded rather than fabricated.
