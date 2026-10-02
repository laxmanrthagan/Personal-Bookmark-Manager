# Personal Bookmark Manager

Local web application scaffold using React, Node.js + Express, and SQLite.

## Project structure

- `client/` — React frontend built with Vite
- `server/` — Express API and SQLite database initialization
- `docs/` — planning and design documents
- `requirements/` — application requirements and source assignment PDF

## Run locally

Install dependencies with `npm install`, then start the React development server and Express API together with `npm run dev`.

- Web UI: http://127.0.0.1:5173
- API health check: http://127.0.0.1:3001/api/health
- SQLite file: `server/data/bookmarks.sqlite` (created on first server start and excluded from version control)

To build the frontend for the local Express server, run `npm run build` and then `npm start`.

Run the database schema tests with `npm run test --workspace server`.

Features 1–9 are implemented: add, list, filter, search, edit, and delete bookmarks; assign optional tags; validate URL/title/tag input; and detect duplicate URLs on creation and edit. Search is case-insensitive substring matching and can be combined with a selected tag. Tags are comma-separated, case-insensitively deduplicated, and displayed on bookmark cards. Canonical URL comparison normalizes scheme/hostname case and default ports while preserving paths, queries, and fragments.
