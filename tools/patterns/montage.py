"""Side-by-side montage of PNGs, scaled to a common height, with captions.
usage: python3 tools/patterns/montage.py out.png height a.png[:caption] b.png[:caption] ..."""
import sys
from PIL import Image, ImageDraw

out, h = sys.argv[1], int(sys.argv[2])
tiles = []
for arg in sys.argv[3:]:
    path, _, cap = arg.partition(':')
    im = Image.open(path).convert('RGB')
    im = im.resize((int(im.width * h / im.height), h))
    ImageDraw.Draw(im).text((8, 8), cap or path.split('/')[-1], fill=(0, 0, 0))
    tiles.append(im)
sheet = Image.new('RGB', (sum(t.width for t in tiles), h), 'white')
x = 0
for t in tiles:
    sheet.paste(t, (x, 0))
    x += t.width
sheet.save(out)
