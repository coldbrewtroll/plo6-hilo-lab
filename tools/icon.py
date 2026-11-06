"""App icon for the phone / home-screen version: felt-green rounded tile with two fanned cards and 'PLO6'."""
from PIL import Image, ImageDraw, ImageFont
import sys, pathlib
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'docs')
B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def icon(n, maskable=False):
    S = 1024
    im = Image.new('RGB', (S, S), '#0c1015'); d = ImageDraw.Draw(im)
    pad = 0 if maskable else 0
    # felt
    d.ellipse([90, 170, S - 90, S - 170], fill='#1d7a4a', outline='#3a2a1c', width=46)
    d.ellipse([150, 230, S - 150, S - 230], outline=(255, 255, 255, 30), width=6)
    # two fanned cards
    def card(cx, cy, ang, rank, suit, col):
        c = Image.new('RGBA', (300, 420), (0, 0, 0, 0)); cd = ImageDraw.Draw(c)
        cd.rounded_rectangle([0, 0, 299, 419], 34, fill='#fbfbf8', outline='#d8d8d0', width=4)
        f1 = ImageFont.truetype(B, 170); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 150)
        cd.text((150, 150), rank, font=f1, fill=col, anchor='mm'); cd.text((150, 310), suit, font=f2, fill=col, anchor='mm')
        c = c.rotate(ang, resample=Image.BICUBIC, expand=True)
        im.paste(c, (cx - c.width // 2, cy - c.height // 2), c)
    card(375, 460, 10, 'A', '♠', '#111111'); card(650, 460, -10, '2', '♥', '#d0312d')
    f = ImageFont.truetype(B, 150)
    d.text((S // 2, 845), 'PLO6', font=f, fill='#ffffff', anchor='mm')
    return im.resize((n, n), Image.LANCZOS)
out.mkdir(parents=True, exist_ok=True)
for n in (180, 192, 512): icon(n).save(out / f'icon-{n}.png', optimize=True)
print('icons written to', out)
