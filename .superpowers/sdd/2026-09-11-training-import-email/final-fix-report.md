# Education Training Import Email — Final Fix Report

Date: 2026-09-11

Reviewed base: `c137224a423d23dc9360d5c4ee5ecbaf105f9d45` (`Fix deployment guide target`)

Scope: the final-review fix wave only; no mail, deployment, publication, or other external mutation was performed.

## Outcome

All Critical and Important findings were fixed. All five Minor findings were also fixed in the touched workflow. The final available suite completed all 27 `test/*.test.js` files with exit code 0.

## Changes by finding

### Critical 1 — typed timestamps and explicit Asia/Taipei parsing

- `readTrainingImportSheetRows_` now captures typed `getValues()` rows in addition to display rows, and qualification/course selection consume the typed training and progress rows.
- `parseTrainingImportTaipeiTimestampMs_` handles `Date` objects without string reparsing, including cross-realm Date objects, and explicitly interprets safe year-first legacy text as Asia/Taipei.
- Legacy Chinese meridiem and prefix/suffix AM/PM forms are supported; ambiguous date-order strings remain rejected rather than guessed.
- Certification dates continue to be formatted in Asia/Taipei after comparing the typed quiz/watch instants.
- Regressions cover a Date instant crossing the Taipei date boundary, Chinese localized text, suffix PM text, and contradictory display values losing to typed values.

### Important 1 — complete worksheet indexing and hidden-row rejection

- The first worksheet `sheetData` is parsed once into a row-number index.
- Every worksheet row must have exactly one positive integer `r`; duplicate, missing, malformed, and repeated row indexes fail closed.
- Rows 1–1000 must all exist. Duplicate A:N cells and A:N cell references that do not match their containing row are rejected.
- Any formula or non-empty A:N value beyond row 1000 is rejected, including a hidden `A1001` embedded in another row element. Empty trailing rows and unrelated cells outside A:N remain preserved.
- Template validation, population, and generated-workbook verification share the indexed representation, eliminating first-match lookup behavior.

### Important 2 — one-batch reservation write

- `reserveTrainingImportBatch_` builds the exact 14-column reservation matrix and writes the full batch with one `getRange(...).setValues(...)` call.
- The existing pre-send `SpreadsheetApp.flush()` remains before `MailApp.sendEmail`.
- A 999-learner regression proves one 999×14 write and zero `appendRow` calls.

### Important 3 — structured non-sendable previews

- Learner data errors and no-pending states now return `success: true`, `canSend: false`, retained valid rows, counts, and `{email, name, message}` error objects.
- All-preparing results explicitly expose the manual-review count and reason.
- Over-capacity data is also a non-sendable preview; configuration, authorization, template, and system failures remain transport failures (`success: false`).
- The browser formats structured errors explicitly, never renders `[object Object]`, and keeps confirmation disabled.

### Important 4 — safe ledger discovery and exact headers

- Spreadsheet candidates are deduplicated by spreadsheet ID before ledger inspection.
- Every discovered existing ledger must match the exact 14-column header contract; even whitespace-altered headers fail closed.
- A sole ledger with history is canonical even when another candidate ledger is empty. Two ledgers with history fail closed and require reconciliation.
- The selected canonical spreadsheet is retained as the write target for execution.

### Important 5 — accepted-but-unlogged outcome and reconciliation

- Successful execution returns `batchId`, `sentCount`, `attachmentName`, `mailAccepted: true`, and `requiresManualReview: false` without claiming confirmed delivery.
- If MailApp accepts the request but final ledger persistence fails, execution returns the same batch details with `mailAccepted: true`, `requiresManualReview: true`; the reserved rows remain `準備寄送` and automatic retry stays blocked.
- The UI invalidates the prior hash and reloads preview after every execution success, structured failure, or RPC failure.
- Normal success and warning dialogs display batch ID, row count, and attachment name. The warning keeps the modal available for review.
- `GEMINI.md` now gives an exact whole-batch reconciliation procedure and requires unresolved batches to remain `準備寄送` without retry.

### Minor 1 — monotonic stale-response protection

- Separate monotonic request IDs protect course-list and preview requests.
- Closing/reopening and A→B→A selection sequences cannot apply stale callbacks.

### Minor 2 — public DTO allowlist

- `buildPublicTrainingImportPreviewDto_` explicitly constructs the public preview response.
- Internal source/context/template references, learner identity collections, hash inputs, and future internal fields are not copied implicitly.

### Minor 3 — one captured context and lightweight course listing

- `buildMentionContext_` accepts captured source rows instead of rereading the five sheets.
- Training/progress context uses the same typed rows as qualification, preventing contradictory typed/display snapshots.
- Course listing reads only training and progress sheets and skips personnel, organization, ledger, template, and context work.

### Minor 4 — fresh transition timestamps

- Reservation time, post-MailApp accepted time, and failure-handling time are captured independently in Asia/Taipei.
- Tests prove the final/failure update does not reuse the reservation time.

### Minor 5 — operator guide corrections

- The documented passing threshold is now 70, matching runtime behavior.
- Deployment instructions cover `DASHBOARD_ALLOWED_EMAILS` and require a resolvable Chinese name for every authorized operator, not only the deploying account.

## RED / GREEN evidence

Behavior tests were added before each implementation slice. Representative RED observations and their GREEN results:

| Area | RED observation | GREEN command/result |
| --- | --- | --- |
| Timestamp domain | New parser was absent; Date/localized assertions failed. Suffix-PM parsing returned `0` instead of `1789054200000`. | `node test/training-import-domain.test.js` → `Training import domain tests passed.` |
| Typed source/context | Contradictory localized display timestamps reached context; `lastActivityAt` contained `2026/09/13`. | `node test/training-import-preview.test.js` → `Training import preview tests passed.` |
| XLSX indexing/bounds | Duplicate/unindexed/hidden rows did not throw; embedded `A1001` reported “Missing expected exception.” | `node test/training-import-xlsx.test.js` → `Training import XLSX tests passed.` |
| Batch reservation | The 999-row regression observed zero range writes because reservations used `appendRow`. | `node test/training-import-send.test.js` → `Training import send tests passed.` |
| Structured preview | Invalid learner/no-pending cases returned flat `success: false` and discarded preview state. | `node test/training-import-preview.test.js` → pass. |
| Ledger selection | A malformed header was accepted; the strict whitespace-header assertion initially got `true !== false`. Empty-first and dual-history behavior was unsafe. | `node test/training-import-preview.test.js` → pass. |
| Accepted-but-unlogged | The failure response returned `sentCount: 0` and omitted the batch outcome fields. | `node test/training-import-send.test.js` → pass. |
| Frontend concurrency/outcomes | A stale course list appended an option after reopen; the first A response in A→B→A could enable confirmation; outcome details/reload assertions failed. | `node test/training-import-frontend.test.js` → `training import frontend behavior: PASS`. |

Documentation-only wording was protected by extending `test/training-import-deployment.test.js` with checks for 70 points, the allowlist/operator-name requirement, and both reconciliation terminal states.

## Files changed

- `code.js`
- `mention.html`
- `GEMINI.md`
- `test/training-import-domain.test.js`
- `test/training-import-xlsx.test.js`
- `test/training-import-preview.test.js`
- `test/training-import-send.test.js`
- `test/training-import-frontend.test.js`
- `test/training-import-deployment.test.js`
- `.superpowers/sdd/2026-09-11-training-import-email/final-fix-report.md`

## Verification commands and output

Focused checks used during iteration:

```text
node test/training-import-domain.test.js
Training import domain tests passed.

node test/training-import-xlsx.test.js
Training import XLSX tests passed.

node test/training-import-preview.test.js
Training import preview tests passed.

node test/training-import-send.test.js
Training import send tests passed.

node test/training-import-frontend.test.js
training import frontend behavior: PASS

node test/training-import-deployment.test.js
exit 0

node --check code.js
exit 0

git diff --check
exit 0
```

The XLSX test initially encountered sandbox `spawnSync unzip EPERM` when included in an unapproved chained command. Running its approved standalone command succeeded; this was an execution-permission artifact, not a test or product failure.

Final full available suite (run once after runtime changes were complete):

```text
/bin/bash -lc 'for test_file in test/*.test.js; do node "$test_file" || exit 1; done'
exit 0 (27 test files, 10.39 seconds)
```

The suite intentionally prints a mocked `磁碟空間不足` stack in `export-report-integration.test.js` while testing its error handler; that test then reports success and the overall process exits 0.

## Self-review

- Rechecked every reviewer finding against the binding design and plan.
- Confirmed the A:N workbook contract and 14-column ledger header remain unchanged.
- Confirmed source template parts and unrelated allowed worksheet content are preserved; out-of-contract hidden A:N records fail closed.
- Confirmed the public response is allowlisted and GAS-serializable, while server-only Blob, spreadsheet, Map, identity collections, and hash inputs stay private.
- Confirmed no path can resend a `準備寄送` learner automatically, including an accepted-but-unlogged outcome.
- Confirmed reservation persistence and flush still precede MailApp, and final status timestamps are fresh.
- Confirmed the old preview hash is invalidated for every execute callback and structured errors cannot enable confirmation.
- Reviewed the diff for unrelated notification/report behavior; no existing notification or export path was intentionally changed.
- `node --check code.js` and `git diff --check` both pass.

## Remaining concerns / manual validation

- Local tests use GAS/Sheet/MailApp mocks. No real email was sent. A deployment owner should perform the existing controlled non-production Apps Script smoke test before production rollout.
- `MailApp.sendEmail` acceptance is not proof of final delivery. Operators must use the documented audit procedure and leave uncertain batches in `準備寄送`.
- OOXML validation is intentionally strict for the approved template structure. A future template revision that changes the 1,000-row skeleton or exact A:N/header contracts must be reviewed and versioned rather than silently accepted.
