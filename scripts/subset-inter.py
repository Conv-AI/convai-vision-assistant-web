"""Splits Inter into one file per script, so a page loads only the letters it shows.

The kit's Inter (src/kit/fonts/Inter-Variable.woff2, all of it, 350 kB) is cut into the subsets
Google Fonts serves Inter in, the Latin one with the few symbols the app's own words use, and one
more file for every letter none of them holds (other arrows, math, the font's private glyphs). Each
subset keeps every layout feature, both axes and the names, so a letter draws as from the whole
file. src/kit/fonts/inter.css gets one @font-face per file with its unicode-range: the browser
fetches a file only once a letter in its range is on the page.

Run it again only when Inter itself changes; its output is committed. It needs fontTools and
brotli (pip install fonttools brotli):

    python scripts/subset-inter.py
    pnpm exec prettier --write src/kit/fonts/inter.css
"""

import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = os.path.join(os.path.dirname(__file__), '..', 'src', 'kit', 'fonts')
SOURCE = os.path.join(FONTS, 'Inter-Variable.woff2')

# The arrows and the Mac's key symbols (Control, Option, Shift, Command) the app's own words show
# (key caps, Settings › Shortcuts): with the Latin letters, not with the rare symbols.
APP_SYMBOLS = 'U+2190, U+2192, U+21E7, U+2303, U+2318, U+2325'

# Google Fonts' ranges for Inter, in its order (fonts.googleapis.com/css2?family=Inter, 2026).
RANGES = [
    ('cyrillic-ext', 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F'),
    ('cyrillic', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'),
    ('greek-ext', 'U+1F00-1FFF'),
    ('greek', 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF'),
    (
        'vietnamese',
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, '
        'U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    ),
    (
        'latin-ext',
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, '
        'U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, '
        'U+2113, U+2C60-2C7F, U+A720-A7FF',
    ),
    (
        'latin',
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, '
        'U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, '
        'U+FFFD, ' + APP_SYMBOLS,
    ),
]


def parse(ranges):
    points = set()
    for part in ranges.split(','):
        lo, _, hi = part.strip()[2:].partition('-')
        points.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return points


def as_ranges(points):
    """Code points as the shortest unicode-range text."""
    out, ordered = [], sorted(points)
    start = prev = ordered[0]
    for point in ordered[1:] + [None]:
        if point is not None and point == prev + 1:
            prev = point
            continue
        out.append(f'U+{start:04X}' if start == prev else f'U+{start:04X}-{prev:04X}')
        if point is not None:
            start = prev = point
    return ', '.join(out)


def cut(name, points):
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_outline = True
    font = TTFont(SOURCE)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    path = os.path.join(FONTS, f'Inter-Variable-{name}.woff2')
    font.flavor = 'woff2'
    font.save(path)
    return path


def main():
    mapped = set(TTFont(SOURCE).getBestCmap())
    faces, covered = [], set()
    for name, text in RANGES:
        points = parse(text) & mapped
        covered |= points
        faces.append((name, text, points))
    rest = mapped - covered
    if rest:
        faces.insert(0, ('symbols', as_ranges(rest), rest))
    if set().union(*(p for _, _, p in faces)) != mapped:
        sys.exit('subset-inter: the subsets do not hold every letter of the font')

    rules = []
    for name, text, points in faces:
        path = cut(name, points)
        print(f'{os.path.getsize(path):>8} {os.path.basename(path)} ({len(points)} letters)')
        rules.append(
            '@font-face {\n'
            '  font-family: Inter;\n'
            f"  src: url('./Inter-Variable-{name}.woff2') format('woff2');\n"
            '  font-weight: 100 900;\n'
            '  font-style: normal;\n'
            '  font-display: swap;\n'
            f'  unicode-range: {text};\n'
            '}\n'
        )
    header = (
        '/*\n'
        ' * Inter, cut by script so a page loads only the letters it shows. Written by\n'
        ' * scripts/subset-inter.py from Inter-Variable.woff2; do not edit by hand.\n'
        ' */\n\n'
    )
    with open(os.path.join(FONTS, 'inter.css'), 'w', encoding='utf-8', newline='') as out:
        out.write(header + '\n'.join(rules))


main()
