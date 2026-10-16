#!/usr/bin/env python3
"""Builds public/regsheet/template.pdf from the official Play! Pokémon deck list PDF.

Usage: python3 tools/build_regsheet_template.py play-pokemon-deck-list-85x11.pdf
Needs: Python 3.10+, pip install pikepdf pillow (built with pikepdf 10.13), and poppler (pdftoppm, pdftotext).

Source: Pokémon's "play-pokemon-deck-list-85x11.pdf" (Play! Pokémon rules & resources page), the
"2026 Pokémon TCG Tournament Season through 30th Celebration" sheet, sha256 193f7d791864015146aaa04843db3bc0b1fad42c12ad02d9e496a3f17a8e3486.
The sheet's footer reads "Noncommercial reproduction permitted"; Benchmark is free (no ads or affiliate
links), and the artwork is reproduced untouched. Revisit if that ever changes.

The template is the official sheet, made easy to fill in from the browser:
  * two identical pages (page 2 is only kept when a deck's cards spill over), each with an empty
    overlay content stream appended to its contents, where the site writes the filled-in text;
  * Helvetica / Helvetica-Bold added to each page's fonts as /BMH and /BMHB;
  * InDesign's private data and the XMP metadata stripped (they're most of the file size);
  * saved with a classic xref table, so the site can append one small incremental update.
It also writes src/lib/regsheet-template.json (object numbers the site needs) and public/regsheet/preview.webp.

When Pokémon publishes a new season's sheet:
  1. Run this script on it (the object map and preview update themselves).
  2. Re-measure the field positions in src/lib/regsheet.ts (TOPS rows, check boxes, name/ID/date blanks,
     column centres): `pdftotext -bbox` gives label positions, and a 200 dpi `pdftoppm` render shows row bands.
  3. Update DIVISION_BORN in src/lib/regsheet.ts; this script stops if the sheet's printed years differ.
  4. Render a filled sheet and compare it with the blank one before shipping.
"""
import json, re, subprocess, sys, tempfile
from pathlib import Path
import pikepdf
from PIL import Image

src = Path(sys.argv[1])
out_dir = Path(__file__).resolve().parent.parent / 'public' / 'regsheet'
out_dir.mkdir(parents=True, exist_ok=True)
tpl = out_dir / 'template.pdf'

pdf = pikepdf.open(src)
if '/Metadata' in pdf.Root: del pdf.Root.Metadata
if '/PieceInfo' in pdf.Root: del pdf.Root.PieceInfo
page = pdf.pages[0].obj
for k in ('/PieceInfo', '/Metadata', '/Thumb'):
    if k in page: del page[k]
res = page.Resources
fonts = res.Font if '/Font' in res else pikepdf.Dictionary()
fonts.BMH = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding))
fonts.BMHB = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name('/Helvetica-Bold'), Encoding=pikepdf.Name.WinAnsiEncoding))
res.Font = fonts
contents = page.Contents if isinstance(page.Contents, pikepdf.Array) else pikepdf.Array([page.Contents])
orig = list(contents)
ov1 = pdf.make_stream(b' ')
page.Contents = pikepdf.Array(orig + [ov1])
# Page 2: same artwork and resources, its own overlay.
pdf.pages.append(pdf.pages[0])
p2 = pdf.pages[1].obj
ov2 = pdf.make_stream(b' ')
p2.Contents = pikepdf.Array(orig + [ov2])
pdf.docinfo = pdf.make_indirect(pikepdf.Dictionary(Title='Play! Pokémon Deck List', Producer='Benchmark (template from the official Play! Pokémon deck list)'))
pdf.save(tpl, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=True,
         stream_decode_level=pikepdf.StreamDecodeLevel.generalized, deterministic_id=True)

# Object numbers and the trailer, read back from the saved file.
re_pdf = pikepdf.open(tpl)
pages = re_pdf.Root.Pages
p1o, p2o = re_pdf.pages[0].obj, re_pdf.pages[1].obj
info = {
    'pages': pages.objgen[0],
    'page': [p1o.objgen[0], p2o.objgen[0]],
    'overlay': [p1o.Contents[-1].objgen[0], p2o.Contents[-1].objgen[0]],
    'root': re_pdf.Root.objgen[0],
    'info': re_pdf.trailer.Info.objgen[0],
    'size': int(re_pdf.trailer.Size),
    'id': [bytes(x).hex() for x in re_pdf.trailer.ID],
    'pagesDict': '',
}
raw = tpl.read_bytes()
info['startxref'] = int(re.findall(rb'startxref\s+(\d+)', raw)[-1])
assert raw.rstrip().endswith(b'%%EOF') and b'\nxref\n' in raw, 'expected a classic xref table'
# The Pages dictionary, minus Kids/Count (the site writes those).
d = {k: v for k, v in pages.items() if k not in ('/Kids', '/Count', '/Parent')}
def unparse(v):
    return v.unparse(resolved=False).decode() if hasattr(v, 'unparse') else str(v)
info['pagesDict'] = ' '.join(k + ' ' + unparse(v) for k, v in d.items())
(Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'regsheet-template.json').write_text(json.dumps(info, indent=1) + '\n')

# The age divisions printed on the sheet must match DIVISION_BORN in src/lib/regsheet.ts.
text = subprocess.run(['pdftotext', '-layout', str(src), '-'], capture_output=True, text=True, check=True).stdout
ts = (Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'regsheet.ts').read_text()
jr = int(re.search(r'Junior Division \(born in (\d{4}) or later\)', text).group(1))
sr = int(re.search(r'Senior Division \(born in (\d{4})', text).group(1))
want = re.search(r'DIVISION_BORN = \{ junior: (\d{4}), senior: (\d{4}) \}', ts)
if not want or (int(want.group(1)), int(want.group(2))) != (jr, sr):
    sys.exit(f'Update DIVISION_BORN in src/lib/regsheet.ts to junior: {jr}, senior: {sr} (and re-check field positions).')

# Preview background: the blank sheet at 150 dpi.
with tempfile.TemporaryDirectory() as t:
    subprocess.run(['pdftoppm', '-r', '150', '-f', '1', '-l', '1', '-png', str(src), f'{t}/p'], check=True)
    img = Image.open(next(Path(t).glob('p*.png'))).convert('RGB')
    img.save(out_dir / 'preview.webp', 'WEBP', quality=82, method=6)
print(tpl, tpl.stat().st_size, 'bytes;', json.dumps({k: v for k, v in info.items() if k != 'pagesDict'}))
