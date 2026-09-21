# SDD ledger — plan: docs/superpowers/plans/2026-09-20-ai-multi-turn-streaming.md

## Pre-flight

- Task 1 produces bounded history and stream parsing helpers consumed by Task 2 and Task 3.
- Task 2 produces the `/ai/ask/stream` event contract consumed by Task 3.
- Task 3 produces `askAiStream` consumed by Task 5.
- Task 4 produces the conversation message model consumed by Task 5.
- Task 5 depends on Task 2, Task 3 and Task 4, so it will not start until those interfaces are verified.

## Status

- Task 1 complete: bounded history validation, Responses multi-turn payload, split-frame SSE parser, delta extraction, JSON fallback, and upstream stream helper implemented and unit-tested.
- Task 2 complete in implementation: `POST /api/books/:bookId/ai/ask/stream` now emits `meta`, `delta`, `done`, and masked `error` events, propagates client aborts, and keeps the old JSON endpoint unchanged.
- Task 3 complete: browser SSE reader handles arbitrary chunk boundaries, UTF-8 decoding, event dispatch, abort signal propagation, and JSON fallback shape.
- Task 4 complete: AI panel now owns a temporary user/assistant transcript, bounded history, per-turn sources, new-conversation reset, and compatibility selectors for the first answer.
- Task 5 complete: streaming Markdown is rendered on animation frames, send becomes stop while generating, stopping aborts the request, and closing/new conversation clears the transient session.
- Verification so far: `npm run test:core` 87 passed / 2 skipped; AI-focused Chromium tests 8 passed.
- Task 6 complete: full E2E, portable structure validation, diff check, FPK rebuild and package-content verification completed.
- Final verification: `npm run test:core` 87 passed / 2 skipped; AI-focused Chromium 8 passed; full Chromium 58 passed / 2 optional skipped / 1 existing timing-flaky case failed in the full run and passed when rerun alone; portable check and diff check passed.
- Artifact: `dist/babyreader-fnos.fpk`, 4,304,847 bytes, SHA-256 `C56DF10DE4D66C5EAA3CDB09DB70F8146785C62C5AD6703668900AB7BCFBFED9`.
