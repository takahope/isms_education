# Repository Guidelines

## Project Structure & Module Organization
This repository contains a small Google Apps Script training web app. The active app lives at the repository root:

- `code.js`: GAS backend entry points such as `doGet()` and spreadsheet write logic.
- `index.html`: single-page frontend with inline CSS and client-side quiz/video logic.
- `GEMINI.md`: project overview and deployment notes.
- `example/`: reference implementation and sample content (`example/code.js`, `example/index.html`, `example/test.md`).

Keep frontend and backend changes in sync. If you add fields in `index.html`, update the sheet write logic in `code.js` in the same change.

## Build, Test, and Development Commands
There is no local build pipeline or package manager configured. Development is done by editing files here and pasting or syncing them into Google Apps Script.

- `git status`: review pending changes before editing or deploying.
- `git diff`: inspect frontend/backend changes together.
- `rg "submitTrainingResult|doGet|google.script.run"`: trace key integration points quickly.

Run and verify through a GAS web app deployment bound to a Google Sheet. Use the steps in `GEMINI.md` as the baseline deployment flow.

## Coding Style & Naming Conventions
Use 2-space indentation in both JavaScript and HTML. Prefer simple vanilla JavaScript and inline comments only where the logic is non-obvious. Keep UI text and comments in Traditional Chinese (`zh-TW`) to match the existing codebase.

Use:

- `camelCase` for variables and functions, for example `getCurrentUserEmail`.
- clear uppercase constants in frontend scripts, for example `PASSING_SCORE`.
- descriptive sheet/tab names such as `訓練紀錄`.

## Testing Guidelines
No automated test framework is configured yet. Validate changes manually in the deployed Apps Script web app.

Before opening a PR, verify:

1. the page loads from `doGet()` without HTML filename mismatches;
2. quiz submission writes the expected columns to the target sheet;
3. video progress, unlock flow, and reload behavior still work in browser.

## Commit & Pull Request Guidelines
Follow the existing Git history: short, imperative English subjects such as `Add initial implementation of backend logic`. Keep commits focused on one change.

PRs should include:

- a brief summary of user-visible behavior;
- any Google Sheet or Apps Script deployment changes;
- screenshots for UI edits;
- manual test notes covering submission and result storage.

## Security & Configuration Tips
Avoid hardcoding spreadsheet IDs, personal data, or secrets in the frontend. Treat all client data as untrusted and validate it in `code.js` before writing to Sheets.
