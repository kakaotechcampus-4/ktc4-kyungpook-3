import json
import os

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(FRONTEND, 'src', 'shared', 'styles', 'fonts')
OUT = os.path.join(FRONTEND, 'node_modules', '.cache', 'font-bench')
WEIGHTS = ['Light', 'Regular', 'Bold', 'ExtraBold']
BULLET = 0x2022


def ks_syllables():
    out = set()
    for hi in range(0xB0, 0xC9):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(ord(bytes([hi, lo]).decode('euc_kr')))
            except UnicodeDecodeError:
                pass
    return sorted(c for c in out if 0xAC00 <= c <= 0xD7A3)


def to_range(cps):
    spans, start, prev = [], None, None
    for c in sorted(cps):
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            spans.append((start, prev))
            start = prev = c
    spans.append((start, prev))
    return ', '.join(f'U+{a:X}-{b:X}' if a != b else f'U+{a:X}' for a, b in spans)


def write(weight, cps, path):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.desubroutinize = True
    font = subset.load_font(os.path.join(SRC, f'NanumSquare-{weight}.woff2'), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subset.save_font(font, path, opts)
    return os.path.getsize(path)


def main():
    ks = ks_syllables()
    ks_set = set(ks)
    cmap = set(TTFont(os.path.join(SRC, 'NanumSquare-Regular.woff2')).getBestCmap())
    parts = {
        'base': sorted(c for c in cmap if not 0xAC00 <= c <= 0xD7A3 and c != BULLET),
        'ks': ks,
        'rest': sorted(c for c in cmap if 0xAC00 <= c <= 0xD7A3 and c not in ks_set),
    }
    sizes = {}
    for w in WEIGHTS:
        for name, cps in parts.items():
            sizes[f'split/{w}-{name}'] = write(w, cps, os.path.join(OUT, 'split', f'NanumSquare-{w}-{name}.woff2'))
        sizes[f'opt/{w}'] = write(w, sorted(cmap), os.path.join(OUT, 'opt', f'NanumSquare-{w}.woff2'))
    ranges = {
        'base': 'U+0-2021, U+2023-ABFF, U+D7A4-10FFFF',
        'ks': to_range(ks),
        'rest': 'U+AC00-D7A3',
    }
    with open(os.path.join(OUT, 'split.json'), 'w', encoding='utf8') as f:
        json.dump({'sizes': sizes, 'ranges': ranges}, f, indent=1)
    print(json.dumps(sizes, indent=1))


main()
