# Repository Guidelines

## Project Structure & Module Organization
This repository contains a Google Apps Script (GAS) training web app. The active deployment target lives at the repository root:

- `code.js`: GAS backend entry points such as `doGet()`, account lookup helpers, and spreadsheet write logic.
- `index.html`: single-page frontend with inline CSS and client-side video/quiz flow.
- `env.js`: environment-specific constants such as `ENV.MASTER_SHEET_ID`.
- `GEMINI.md`: project overview and deployment notes.
- `example/`: reference and legacy sample material, not the primary deployment target.
- `conductor/`: planning notes and refactor documents, not runtime code.

Keep frontend and backend changes in sync. If you change the submission payload in `index.html`, update the corresponding handling and sheet write logic in `code.js` in the same change.

## Build, Test, and Development Commands
There is no local build pipeline or package manager configured. Development is done by editing files here and pasting or syncing them into Google Apps Script.

- `git status --short`: review pending changes before editing or deploying.
- `git diff -- code.js index.html env.js AGENTS.md`: inspect the main app files together.
- `rg "submitTrainingResult|getCurrentUserEmail|getUserNameByEmail|google.script.run|MASTER_SHEET_ID"`: trace key integration points quickly.

Run and verify through a GAS web app deployment bound to a Google Sheet. Use the steps in `GEMINI.md` as the baseline deployment flow.

## Coding Style & Naming Conventions
Use 2-space indentation in both JavaScript and HTML. Prefer simple vanilla JavaScript with inline CSS/JS in GAS HTML files, matching the current app structure. Keep user-facing text in Traditional Chinese (`zh-TW`). Use comments sparingly and keep them consistent within the file being edited.

Use:

- `camelCase` for variables and functions, for example `getCurrentUserEmail`.
- clear uppercase constants in frontend scripts, for example `PASSING_SCORE`.
- descriptive sheet/tab names such as `訓練紀錄` and `人員主檔`.

## Configuration Notes
- `env.js` is required for environment-specific configuration. Keep production IDs and similar values there, not in `index.html`.
- `ENV.MASTER_SHEET_ID` must point to a Google Spreadsheet that contains a `人員主檔` sheet.
- The current backend expects `人員主檔` column A to contain user email addresses and column B to contain display names.
- Treat `example/` as reference material only. Do not update deployment instructions to point there unless the active app is intentionally moved.

## Backend / Frontend Contract
- `doGet()` must continue serving `index` unless you intentionally rename the HTML file and update both sides together.
- `submitTrainingResult(data)` currently expects `userName`, `videoTitle`, `score`, and `isPassed`.
- The `userName` field currently carries the user email. If you rename or normalize that payload key, update both `index.html` and `code.js` together.
- Preserve the `訓練紀錄` sheet output contract unless the sheet schema change is part of the task. The current columns are timestamp, name, email, course title, score, and result.

## Testing Guidelines
No automated test framework is configured yet. Validate changes manually in the deployed Apps Script web app.

Before opening a PR, verify:

1. `doGet()` loads `index.html` without filename mismatches.
2. `env.js` is present and `ENV.MASTER_SHEET_ID` points to a reachable spreadsheet.
3. `getCurrentUserEmail()` returns the expected account in the deployed environment.
4. `getUserNameByEmail()` resolves names correctly from `人員主檔`.
5. quiz submission writes the expected six columns into `訓練紀錄`.
6. video anti-fast-forward, idle confirmation, blur/visibility pause, unlock flow, and `localStorage` resume behavior still work in browser.

## Commit & Pull Request Guidelines
Follow the existing Git history: short, imperative English subjects such as `Add initial implementation of backend logic`. Keep commits focused on one change.

PRs should include:

- a brief summary of user-visible behavior;
- any Google Sheet or Apps Script deployment changes;
- screenshots for UI edits;
- manual test notes covering submission and result storage.

## Security & Configuration Tips
Avoid hardcoding spreadsheet IDs, personal data, or secrets in the frontend. Treat all client data as untrusted and validate it in `code.js` before writing to Sheets.
- Keep external spreadsheet IDs in `env.js` or Apps Script-managed configuration, not in client-side code.
- Be careful when sharing docs or screenshots not to expose production spreadsheet IDs, user emails, or internal training data.

