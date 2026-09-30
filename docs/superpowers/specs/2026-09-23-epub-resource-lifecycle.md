# EPUB Resource Lifecycle Specification

## Goal

Ensure images and other in-archive visual assets remain available across chapter navigation in large EPUBs without repeatedly inflating duplicate resources or allowing unbounded browser memory growth.

## Evidence and root cause

The active reader uses the custom JSZip parser in `app/ui/reader/epub.js`. The archive owns one lifetime budget (`maxInlineResourceBytes: 8 MiB`, `maxInlineTotalBytes: 48 MiB`). `resourceDataUrl()` reserves the uncompressed size on every call, before checking whether the path was already loaded. A resource referenced by multiple spine documents is therefore charged repeatedly. The reported EPUB has about 4.7 MiB of unique referenced image data but about 80.6 MiB of cumulative inflated references, so later chapter assets are skipped after the lifetime budget is consumed.

The parser currently converts bytes to a binary string and then Base64 data URL. This creates extra copies and retains resource strings in rendered markup. The existing 8 MiB single-resource cap and server-side ZIP bounds are useful safety controls and must not be removed as a workaround.

## Behavior

1. Resolve local resource URLs relative to the owning XHTML or stylesheet using the existing ZIP path normalization rules. Reject paths that escape the archive root and do not fetch external URLs.
2. Inflate each normalized in-archive path once per open archive; concurrent callers for the same path share the in-flight result.
3. Represent binary resources as Blob URLs rather than Base64 data URLs.
4. Keep resources pinned while a rendered chapter uses them. When chapter rendering commits, release the previous chapter only after its markup is replaced. A stale or failed render releases its own uncommitted lease without disturbing the visible chapter.
5. Enforce a bounded cache using unique uncompressed bytes. Evict and revoke only unpinned resources. Keep the 8 MiB per-resource limit. Set cache and concurrent-inflation limits explicitly and test them.
6. Destroying an EPUB archive revokes every remaining URL exactly once and clears in-flight/cache state. Switching books must not reuse an archive's URLs.
7. Asset failures leave text and navigation usable and increment bounded, content-free diagnostics. Do not log extracted text, image bytes, or credentials.
8. Preserve the custom JSZip/pagination/annotation/search/bookmark/AI integration. Do not add runtime packages, new server endpoints, or change server ZIP security bounds in this work.

## Security and resource boundaries

- Retain `maxInlineResourceBytes = 8 * 1024 * 1024` unless a separate security/performance review and fixture demonstrate a justified change.
- Do not weaken ZIP compressed-size, entry-count, per-entry, aggregate-uncompressed-size, or compression-ratio checks in `app/server/zip.js` and `app/server/security.js`.
- Cap unique cached uncompressed bytes and simultaneous inflation work; never let pinned resources be silently evicted.
- Normalize and validate every path before ZIP lookup. Unsupported, absent, malformed, and over-limit resources fail closed while the XHTML body remains readable.
- Keep diagnostics bounded and free of book contents.

## Acceptance

- Repeated references and simultaneous requests to one path perform one inflation and one cache charge.
- Unique resource cache usage never exceeds its documented bound except for a single currently acquired resource that is independently within the per-resource cap; when capacity is unavailable, only unpinned entries may be evicted, otherwise the resource is omitted with a diagnostic.
- A chapter lease keeps its URLs valid through DOM replacement and releases them after replacement; failed/stale chapter loads do not revoke URLs belonging to the visible chapter.
- Archive destruction revokes all created URLs exactly once.
- Existing safety tests for oversized resources remain valid, and EPUB render, pagination, text extraction, and non-EPUB paths continue to pass.
- Browser tests cover duplicate assets across chapters, navigation, stale render, archive destruction, and over-limit assets. Real-device acceptance is a later packaging/install step, not claimed by unit tests.

## Non-goals

- Replacing the custom EPUB reader with the full epub.js Rendition API.
- Adding image transcoding or browser-worker infrastructure.
- Raising archive/server ZIP limits or the single-resource cap as part of this fix.
- Changing reading UI, search results, AI context, bookmarks, annotations, or index storage.
