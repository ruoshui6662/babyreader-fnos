# Library Home UI Design QA

## Scope

- Reference: `C:/Users/admin/Downloads/zhenshu_apple_hig_demo_v6_stability_rule.html`
- Changed surfaces: library home layout, book-cover grid, recent-reading card, category navigation, responsive breakpoints, and reserved extension slots.
- Protected behavior: scanning, authorization, search, category assignment/reordering, opening a book, reader routes, and server APIs.

## Static and automated checks

- `npm test`: **PASS** — 528 tests; 520 passed, 0 failed, 8 skipped by environment/platform conditions.
- `npm run check:portable`: **PASS** — required files and lifecycle scripts validated.
- `git diff --check` for the scoped implementation files: **PASS**.
- DOM regression coverage verifies stable home extension slots and one-line responsive grid rules at the documented breakpoints.
- Recent-reading cover regression verifies its 60 × 84 px presentation.

## Responsive targets encoded in the implementation

- Desktop (≥1100 px): 5 columns.
- Compact desktop (920–1099 px): 4 columns.
- Tablet (680–919 px): 3 columns.
- Mobile (<680 px): 2 columns.
- Cover ratio: 3:4.2; card titles and authors remain single-line and clipped safely.

## Browser visual QA

**BLOCKED — not visually verified.** The Codex in-app browser rejected navigation to the local `127.0.0.1` development URL under its URL security policy. No browser-policy workaround or alternate browser surface was used. Therefore no rendered screenshot comparison is claimed for desktop, tablet, or mobile.

### Follow-up: library header controls and divider

- Removed the inherited article-heading underline from the “继续阅读” heading within the library only.
- Root library controls now render in the order “新建分类 → 重新扫描 → 整理/完成”; the search field occupies its own row above them.
- Regression checks: `npm test` **PASS** — 530 tests; 522 passed, 0 failed, 8 skipped by platform/environment. `npm run check:portable` **PASS**; scoped `git diff --check` **PASS**.
- Browser visual comparison remains blocked as stated above; these checks do not establish screenshot-level spacing or narrow-device rendering.

## Handoff status

Automated and static checks passed, but visual design QA remains pending. Before treating the UI pass as visually accepted, open the app in an approved browser context and compare the library home against the reference at desktop, tablet, and mobile widths; verify that real library data still shows cover + title and that category controls remain usable.
