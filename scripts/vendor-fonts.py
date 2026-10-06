#!/usr/bin/env python3
"""Vendor the bundled reading fonts into app/ui/vendor/fonts/.

All five fonts are SIL OFL 1.1 without Reserved Font Names, so subsetting and
converting them to woff2 under their original family names is permitted, and
they may be redistributed with 枕书 (including commercially). Each
family keeps its license file next to its files.

Sources (staged with npm/curl into STAGING; nothing is fetched here):
  - Noto Serif SC (思源宋体)   @fontsource/noto-serif-sc@5.3.0, weight 400
  - Noto Sans SC (思源黑体)    @fontsource/noto-sans-sc@5.3.0, weight 400
  - LXGW WenKai (霞鹜文楷)     lxgw-wenkai-webfont@1.7.0 (font v1.250), regular
  - Zhuque Fangsong (朱雀仿宋) github.com/TrionesType/zhuque release v0.212,
                               split here with fontTools into the same
                               frequency-ordered unicode-range slices that
                               Google Fonts uses for Noto Serif SC
  - Literata                   @fontsource/literata@5.3.0, latin + latin-ext,
                               weights 400 and 700

Usage: python scripts/vendor-fonts.py <STAGING> [FOLDER]
  With FOLDER (e.g. noto-sans-sc) only that family is regenerated, so
  STAGING needs only its package.
  STAGING holds node_modules/ (from `npm install` of the packages above) and
  zhuque/ZhuqueFangsong-Regular.ttf + zhuque/LICENSE.txt.
Requires: fonttools, brotli.
"""

import re
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'app' / 'ui' / 'vendor' / 'fonts'
FACE = re.compile(r'@font-face\s*{(.*?)}', re.S)


def faces(css_text):
    """Yield (declarations-without-src, woff2 url, unicode-range) per face."""
    for body in FACE.findall(css_text):
        woff2 = re.search(r"url\(['\"]?([^'\")]+\.woff2)['\"]?\)", body)
        if not woff2:
            continue
        ur = re.search(r'unicode-range:\s*([^;}]+)', body)
        decls = [line.strip().rstrip(';') for line in body.split(';')]
        decls = [d for d in decls if d and not d.startswith('src') and not d.startswith('unicode-range')]
        yield decls, woff2.group(1), (ur.group(1).strip() if ur else None)


def face_css(decls, url, unicode_range):
    lines = ['@font-face {'] + [f'  {d};' for d in decls]
    lines.append(f"  src: url('{url}') format('woff2');")
    if unicode_range:
        lines.append(f'  unicode-range: {unicode_range};')
    lines.append('}')
    return '\n'.join(lines)


def copy_family(css_path, folder, keep=lambda url: True):
    """Copy a pre-split family's woff2 files; return its CSS (paths rebased)."""
    target = OUT / folder / 'files'
    target.mkdir(parents=True, exist_ok=True)
    blocks = []
    for decls, url, unicode_range in faces(css_path.read_text(encoding='utf-8')):
        if not keep(url):
            continue
        source = (css_path.parent / url).resolve()
        shutil.copy2(source, target / source.name)
        blocks.append(face_css(decls, f'files/{source.name}', unicode_range))
    return blocks


def codepoints(unicode_range):
    points = set()
    for token in unicode_range.split(','):
        token = token.strip().upper().replace('U+', '')
        if not token:
            continue
        if '?' in token:
            start, end = int(token.replace('?', '0'), 16), int(token.replace('?', 'F'), 16)
        elif '-' in token:
            a, b = token.split('-')
            start, end = int(a, 16), int(b, 16)
        else:
            start = end = int(token, 16)
        points.update(range(start, end + 1))
    return points


def split_family(ttf, ranges, folder, family):
    """Subset a single TTF into woff2 slices along the given unicode ranges."""
    target = OUT / folder / 'files'
    target.mkdir(parents=True, exist_ok=True)
    available = set(TTFont(ttf).getBestCmap())
    blocks = []
    for index, unicode_range in enumerate(ranges):
        wanted = codepoints(unicode_range) & available
        if not wanted:
            continue
        options = subset.Options()
        options.flavor = 'woff2'
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.notdef_outline = True
        options.hinting = False
        font = TTFont(ttf)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=wanted)
        subsetter.subset(font)
        name = f'{folder}-{index}.woff2'
        font.flavor = 'woff2'
        font.save(target / name)
        decls = [f"font-family: '{family}'", 'font-style: normal', 'font-weight: 400', 'font-display: swap']
        blocks.append(face_css(decls, f'files/{name}', unicode_range))
    return blocks


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    staging = Path(sys.argv[1]).resolve()
    modules = staging / 'node_modules'
    only = sys.argv[2] if len(sys.argv) == 3 else None
    if only:
        shutil.rmtree(OUT / only, ignore_errors=True)
    elif OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    sections = []  # (folder, title, blocks)
    if only == 'noto-sans-sc' or not only:
        sans_css = modules / '@fontsource' / 'noto-sans-sc' / '400.css'
        sections.append(('noto-sans-sc', 'Noto Sans SC (思源黑体) — OFL 1.1', copy_family(sans_css, 'noto-sans-sc')))
        shutil.copy2(modules / '@fontsource' / 'noto-sans-sc' / 'LICENSE', OUT / 'noto-sans-sc' / 'LICENSE')
    if only:
        write_sections(sections)
        return
    noto_css = modules / '@fontsource' / 'noto-serif-sc' / '400.css'
    sections.append(('noto-serif-sc', 'Noto Serif SC (思源宋体) — OFL 1.1', copy_family(noto_css, 'noto-serif-sc')))
    shutil.copy2(modules / '@fontsource' / 'noto-serif-sc' / 'LICENSE', OUT / 'noto-serif-sc' / 'LICENSE')

    wenkai_css = modules / 'lxgw-wenkai-webfont' / 'lxgwwenkai-regular.css'
    sections.append(('lxgw-wenkai', 'LXGW WenKai (霞鹜文楷) — OFL 1.1', copy_family(wenkai_css, 'lxgw-wenkai')))
    shutil.copy2(modules / 'lxgw-wenkai-webfont' / 'OFL.txt', OUT / 'lxgw-wenkai' / 'LICENSE')

    noto_ranges = [r for _, _, r in faces(noto_css.read_text(encoding='utf-8')) if r]
    zhuque = split_family(staging / 'zhuque' / 'ZhuqueFangsong-Regular.ttf', noto_ranges,
                          'zhuque-fangsong', 'Zhuque Fangsong')
    sections.append(('zhuque-fangsong', 'Zhuque Fangsong (朱雀仿宋) v0.212 — OFL 1.1', zhuque))
    shutil.copy2(staging / 'zhuque' / 'LICENSE.txt', OUT / 'zhuque-fangsong' / 'LICENSE')

    literata = []
    for weight in ('400', '700'):
        literata += copy_family(modules / '@fontsource' / 'literata' / f'{weight}.css', 'literata',
                                keep=lambda url: re.search(r'-latin(-ext)?-\d+-normal\.woff2$', url) is not None)
    sections.append(('literata', 'Literata — OFL 1.1', literata))
    shutil.copy2(modules / '@fontsource' / 'literata' / 'LICENSE', OUT / 'literata' / 'LICENSE')

    write_sections(sections)


def write_sections(sections):
    # One stylesheet per family, next to its files: the reader links only the
    # family in use, and unicode-range slices mean a book only downloads the
    # characters it contains.
    for folder, title, blocks in sections:
        header = (f'/* {title}. Generated by scripts/vendor-fonts.py; do not edit.\n'
                  '   SIL OFL 1.1 without Reserved Font Names; see LICENSE here. */\n')
        (OUT / folder / 'font.css').write_text(header + '\n'.join(blocks) + '\n', encoding='utf-8')
        print(f'{folder}: {len(blocks)} faces')
    total = sum(path.stat().st_size for path in OUT.rglob('*.woff2'))
    print(f'total woff2: {total / 1024 / 1024:.1f} MB')


if __name__ == '__main__':
    main()
