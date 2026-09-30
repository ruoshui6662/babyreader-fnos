# Mozilla PDF.js browser assets

- Package: `pdfjs-dist` `6.3.289` (exactly pinned in the root package manifest and lockfile).
- Upstream: https://github.com/mozilla/pdf.js/tree/v6.3.289
- Distribution: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz
- License: Apache-2.0; see the adjacent `LICENSE` file.
- Included: display API and matching module worker, CMaps, standard fonts, ICC profiles, WASM and image decoder resources.
- Excluded: the stock Viewer UI, PDF scripting sandbox, source maps, Node/legacy builds, examples and test documents.
- Local modifications: none. Do not update these files independently; update the exact package pin, review upstream advisories and license, recopy the listed assets, and run PDF reader tests together.

The display API is configured to reject eval-based compilation and does not enable PDF scripting. All resources are served by BabyReader from this same-origin directory; no CDN fallback is used.
