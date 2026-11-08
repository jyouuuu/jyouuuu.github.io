#!/usr/bin/env python3
"""Compose tattoo reference images onto US Letter practice sheets, black ink only.

What it guarantees
  * Paper: US Letter, 8.5 x 11 in, portrait, 0.5 in margins.
  * Black ink only: every image is embedded as DeviceGray and all text and rules
    are gray/black, so a printer needs nothing but its black cartridge.
  * No distortion: each design keeps its exact aspect ratio (one uniform scale
    factor). Images are placed at their native pixel resolution and are only
    downsampled, uniformly, if they would print finer than --max-dpi.
  * No alteration: no redrawing, filtering, sharpening, contrast changes or
    thresholding. The only pixel change is colour -> grayscale (ITU-R 601 luma).
    Plain near-white paper margins around a design may be trimmed (--trim, on by
    default) so the design fills its cell; photos and anything not sitting on
    white paper are never cropped.

Usage
  python3 compose_sheets.py REFS_DIR OUT_DIR [--cols 3] [--rows 4] [--title TATS]
                            [--no-trim] [--no-labels] [--max-dpi 600]

REFS_DIR holds the images (jpg/png/webp/gif/...). If it contains a manifest.json
(a list of {"file": ...} entries, as written by the fetch step) that order is
used; otherwise files are taken in filename order.

Writes OUT_DIR/<title>_practice_sheets_letter.pdf, a PNG preview per page and
report.json (per design: source size, print size, effective DPI, colour, trim).
"""
import argparse
import json
import math
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageOps
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

PT = 72.0  # points per inch
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


# ---------------------------------------------------------------- images ----

def flatten(im):
    """First frame, EXIF orientation applied, transparency composited on white."""
    try:
        im.seek(0)
    except EOFError:
        pass
    im = ImageOps.exif_transpose(im)
    has_alpha = im.mode in ("RGBA", "LA", "PA") or (
        im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    if im.mode in ("L", "RGB"):
        return im.copy()
    if im.mode in ("1", "I;16", "I", "F"):
        return im.convert("L")
    return im.convert("RGB")


def colour_fraction(im):
    """Share of pixels with visible colour (chroma > 32 of 255)."""
    if im.mode != "RGB":
        return 0.0
    small = im.copy()
    small.thumbnail((400, 400))
    r, g, b = small.split()
    hi = ImageChops.lighter(ImageChops.lighter(r, g), b)
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    hist = ImageChops.subtract(hi, lo).histogram()
    return sum(hist[33:]) / float(small.size[0] * small.size[1])


def blank_margin_box(g, white_min=232, tol=14, pad_frac=0.025):
    """Bounding box of the design if it sits on near-white paper, else None.

    Only rows/columns that are plain paper (within `tol` of the border colour)
    are dropped, and a small pad of paper is kept around the design.
    """
    w, h = g.size
    edge = []
    for box in ((0, 0, w, 1), (0, h - 1, w, h), (0, 0, 1, h), (w - 1, 0, w, h)):
        edge.extend(g.crop(box).tobytes())  # mode L: one byte per pixel
    edge.sort()
    paper = edge[len(edge) // 2]
    if paper < white_min:
        return None  # not on white paper (photo, coloured ground): keep whole
    ink = g.point(lambda v, t=paper - tol: 255 if v < t else 0)
    bbox = ink.getbbox()
    if not bbox:
        return None
    pad = int(round(pad_frac * max(w, h)))
    l, t, r, b = bbox
    l, t, r, b = max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad)
    if (r - l) * (b - t) >= 0.97 * w * h:
        return None
    return (l, t, r, b)


def prepare(path, trim):
    with Image.open(path) as src:
        src_size = src.size
        im = flatten(src)
    colour = colour_fraction(im)
    g = im if im.mode == "L" else im.convert("L")  # ITU-R 601-2 luma
    box = blank_margin_box(g) if trim else None
    if box:
        g = g.crop(box)
    return g, {"source_px": list(src_size), "colour_fraction": round(colour, 4),
               "converted_from_colour": colour > 0.02, "trimmed_to": box}


# ---------------------------------------------------------------- layout ----

class Grid:
    def __init__(self, cols, rows, labels):
        self.page_w, self.page_h = letter
        self.margin = 0.5 * PT
        self.header_h = 0.42 * PT
        self.gutter = 0.22 * PT
        self.label_h = (0.17 * PT) if labels else 0.0
        self.pad = 0.06 * PT
        self.cols, self.rows = cols, rows
        self.content_w = self.page_w - 2 * self.margin
        self.content_top = self.page_h - self.margin - self.header_h
        self.content_h = self.content_top - self.margin
        self.cell_w = (self.content_w - (cols - 1) * self.gutter) / cols
        self.cell_h = (self.content_h - (rows - 1) * self.gutter) / rows
        self.box_w = self.cell_w - 2 * self.pad
        self.box_h = self.cell_h - 2 * self.pad - self.label_h

    def cells(self, count):
        """(x, y) bottom-left of each cell; a short last row is centred."""
        out = []
        for i in range(count):
            r, c = divmod(i, self.cols)
            in_row = min(self.cols, count - r * self.cols)
            shift = (self.cols - in_row) * (self.cell_w + self.gutter) / 2.0
            x = self.margin + shift + c * (self.cell_w + self.gutter)
            y = self.content_top - (r + 1) * self.cell_h - r * self.gutter
            out.append((x, y))
        return out


def draw_header(c, g, title, page_no, pages):
    top = g.page_h - g.margin
    c.setFillGray(0)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(g.margin, top - 10.5, title.upper())
    tw = c.stringWidth(title.upper(), "Helvetica-Bold", 10.5)
    c.setFillGray(0.3)
    c.setFont("Helvetica", 7)
    c.drawString(g.margin + tw + 7, top - 10, "PRACTICE SHEET")
    right = "%02d / %02d" % (page_no, pages)
    c.drawRightString(g.page_w - g.margin, top - 10, right)
    c.setStrokeGray(0)
    c.setLineWidth(0.5)
    rule_y = top - 17
    c.line(g.margin, rule_y, g.page_w - g.margin, rule_y)


def compose(items, out_pdf, title, cols, rows, labels, max_dpi):
    g = Grid(cols, rows, labels)
    per_page = cols * rows
    pages = max(1, math.ceil(len(items) / per_page))
    c = canvas.Canvas(out_pdf, pagesize=letter, pageCompression=1)
    c.setTitle("%s practice sheets" % title)
    c.setAuthor("compose_sheets.py")
    c.setSubject("Letter, black ink only, designs scaled uniformly")
    report = []
    for p in range(pages):
        chunk = items[p * per_page:(p + 1) * per_page]
        draw_header(c, g, title, p + 1, pages)
        for (x, y), it in zip(g.cells(len(chunk)), chunk):
            img = it["image"]
            w_px, h_px = img.size
            s = min(g.box_w / w_px, g.box_h / h_px)  # points per source pixel
            dw, dh = w_px * s, h_px * s
            dpi = w_px / (dw / PT)
            if dpi > max_dpi:  # uniform downsample only; aspect unchanged
                k = max_dpi / dpi
                nw = max(1, round(w_px * k))
                nh = max(1, round(nw * h_px / w_px))
                img = img.resize((nw, nh), Image.LANCZOS)
            ix = x + (g.cell_w - dw) / 2.0
            iy = y + g.label_h + g.pad + (g.box_h - dh) / 2.0
            c.drawImage(ImageReader(img), ix, iy, width=dw, height=dh)
            if labels:
                c.setFillGray(0.35)
                c.setFont("Helvetica", 6.5)
                c.drawCentredString(x + g.cell_w / 2.0, y + g.pad + 2,
                                    "%02d" % it["index"])
            src_ratio = w_px / float(h_px)
            assert abs(dw / dh - src_ratio) < 1e-9 * max(1.0, src_ratio)
            report.append(dict(it["meta"], index=it["index"], file=it["file"],
                               page=p + 1, placed_px=list(img.size),
                               print_in=[round(dw / PT, 3), round(dh / PT, 3)],
                               effective_dpi=round(min(dpi, max_dpi), 1)))
        c.showPage()
    c.save()
    return report, pages


# ------------------------------------------------------------------ main ----

def list_refs(refs_dir):
    man = os.path.join(refs_dir, "manifest.json")
    if os.path.exists(man):
        with open(man, encoding="utf-8") as f:
            data = json.load(f)
        entries = data if isinstance(data, list) else data.get("pins", [])
        files = []
        for e in entries:
            name = os.path.basename(e.get("file", ""))
            if name and os.path.exists(os.path.join(refs_dir, name)):
                files.append(name)
        if files:
            return files
    return sorted(n for n in os.listdir(refs_dir)
                  if os.path.splitext(n)[1].lower() in EXTS)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("refs_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--rows", type=int, default=4)
    ap.add_argument("--title", default="TATS")
    ap.add_argument("--no-trim", dest="trim", action="store_false")
    ap.add_argument("--no-labels", dest="labels", action="store_false")
    ap.add_argument("--max-dpi", type=float, default=600.0)
    ap.add_argument("--preview-dpi", type=int, default=110)
    a = ap.parse_args()

    os.makedirs(a.out_dir, exist_ok=True)
    items = []
    for i, name in enumerate(list_refs(a.refs_dir), 1):
        img, meta = prepare(os.path.join(a.refs_dir, name), a.trim)
        items.append({"index": i, "file": name, "image": img, "meta": meta})
    if not items:
        sys.exit("no images found in %s" % a.refs_dir)

    stem = "%s_practice_sheets_letter" % a.title.replace(" ", "_")
    pdf = os.path.join(a.out_dir, stem + ".pdf")
    report, pages = compose(items, pdf, a.title, a.cols, a.rows, a.labels, a.max_dpi)
    with open(os.path.join(a.out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump({"pdf": os.path.basename(pdf), "pages": pages,
                   "grid": [a.cols, a.rows], "designs": report}, f, indent=1)
    subprocess.run(["pdftoppm", "-r", str(a.preview_dpi), "-png", "-gray", pdf,
                    os.path.join(a.out_dir, stem + "_preview")], check=True)
    low = [r["index"] for r in report if r["effective_dpi"] < 150]
    print("%d designs -> %d pages: %s" % (len(items), pages, pdf))
    if low:
        print("low resolution (< 150 dpi at print size): %s" % low)


if __name__ == "__main__":
    main()
