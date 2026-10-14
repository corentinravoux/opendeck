"""Visual regression: our PDF of a deck against the slides.com PDF of the same deck.

Pages are rasterised at 96 dpi in grey (one pixel per CSS pixel). Two numbers are computed per page:

- M, the tolerant mismatch fraction. A pixel mismatches when it differs by more than `tol`
  (0–255) from every pixel in the 3×3 neighbourhood of the same place in the other image. M is
  computed both ways and the larger value kept. It ignores anti-aliasing and 1 px shifts, but
  catches a missing arrow head, equation or line of text.
- SSIM on luminance, with a Gaussian window (σ = 1.5).

A page passes when M <= M_MAX. SSIM is reported but does not decide: it drops to ~0.5 on
slides with full-page photos whose pixels differ only by image resampling (M stays ~0.2 %).
A deck passes when its page counts match and every page passes. Calibration: docs/regression.md.
"""

from __future__ import annotations

import html
import json
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

TOL = 40
M_MAX = 0.01


def rasterise(pdf: Path, out_dir: Path, prefix: str, dpi: int = 96) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", str(dpi), "-gray", "-png", str(pdf), str(out_dir / prefix)], check=True)
    return sorted(out_dir.glob(f"{prefix}-*.png"))


def load(path: Path, shape: tuple[int, int] | None = None) -> np.ndarray:
    img = Image.open(path).convert("L")
    if shape and img.size != (shape[1], shape[0]):
        img = img.resize((shape[1], shape[0]), Image.BILINEAR)
    return np.asarray(img, dtype=np.float32)


def mismatch_map(a: np.ndarray, b: np.ndarray, tol: float = TOL) -> np.ndarray:
    """Pixels of a that no pixel of b's 3×3 neighbourhood matches within tol."""
    hi = ndimage.maximum_filter(b, size=3)
    lo = ndimage.minimum_filter(b, size=3)
    return (a > hi + tol) | (a < lo - tol)


def tolerant_mismatch(a: np.ndarray, b: np.ndarray, tol: float = TOL) -> float:
    return float(max(mismatch_map(a, b, tol).mean(), mismatch_map(b, a, tol).mean()))


def ssim(a: np.ndarray, b: np.ndarray, sigma: float = 1.5) -> float:
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a, mu_b = ndimage.gaussian_filter(a, sigma), ndimage.gaussian_filter(b, sigma)
    var_a = ndimage.gaussian_filter(a * a, sigma) - mu_a ** 2
    var_b = ndimage.gaussian_filter(b * b, sigma) - mu_b ** 2
    cov = ndimage.gaussian_filter(a * b, sigma) - mu_a * mu_b
    s = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (var_a + var_b + c2))
    return float(s.mean())


@dataclass
class PageResult:
    page: int
    m: float
    ssim: float
    ok: bool


@dataclass
class DeckResult:
    deck: str
    pages_ours: int
    pages_ref: int
    pages: list[PageResult] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.pages_ours == self.pages_ref and all(p.ok for p in self.pages)


def compare(ours_pdf: Path, ref_pdf: Path, work: Path, deck: str, m_max: float = M_MAX) -> DeckResult:
    ours = rasterise(ours_pdf, work, "ours")
    ref = rasterise(ref_pdf, work, "ref")
    result = DeckResult(deck, len(ours), len(ref))
    for i, (po, pr) in enumerate(zip(ours, ref), 1):
        b = load(pr)
        a = load(po, b.shape)
        m, s = tolerant_mismatch(a, b), ssim(a, b)
        ok = m <= m_max
        result.pages.append(PageResult(i, m, s, ok))
        if not ok:
            diff = np.zeros((*a.shape, 3), dtype=np.uint8)
            diff[..., :] = (255 - (a + b) / 4).astype(np.uint8)[..., None]
            diff[mismatch_map(a, b)] = (220, 0, 0)
            diff[mismatch_map(b, a)] = (0, 90, 220)
            Image.fromarray(diff).save(work / f"diff-{i:03d}.png")
    return result


def write_report(results: list[DeckResult], out: Path) -> Path:
    rows, sections = [], []
    for r in results:
        worst = max((p.m for p in r.pages), default=0.0)
        failing = [p for p in r.pages if not p.ok]
        rows.append(f"<tr class={'ok' if r.ok else 'bad'}><td><a href='#{html.escape(r.deck)}'>{html.escape(r.deck)}</a></td>"
                    f"<td>{r.pages_ours}/{r.pages_ref}</td><td>{len(failing)}</td><td>{worst:.4%}</td>"
                    f"<td>{min((p.ssim for p in r.pages), default=1):.4f}</td></tr>")
        figs = "".join(
            f"<figure><figcaption>page {p.page}: M={p.m:.3%} SSIM={p.ssim:.4f}</figcaption>"
            f"<img src='{html.escape(r.deck)}/ref-{p.page:03d}.png' title='slides.com'>"
            f"<img src='{html.escape(r.deck)}/ours-{p.page:03d}.png' title='opendeck'>"
            f"<img src='{html.escape(r.deck)}/diff-{p.page:03d}.png' title='red: only ours, blue: only theirs'></figure>"
            for p in failing)
        sections.append(f"<h2 id='{html.escape(r.deck)}'>{html.escape(r.deck)}</h2>{figs or '<p>all pages pass</p>'}")
    page = f"""<!DOCTYPE html><meta charset=utf-8><title>opendeck regression</title>
<style>body{{font:14px sans-serif;margin:16px}} td,th{{padding:2px 10px}} tr.bad td{{background:#fdd}}
tr.ok td{{background:#dfd}} figure{{margin:8px 0}} img{{width:32%;border:1px solid #ccc;margin-right:4px}}</style>
<h1>slides.com PDF vs opendeck PDF</h1>
<p>M = tolerant mismatch fraction (pass &le; {M_MAX:.1%}); SSIM shown for information. Diff: red = only in ours, blue = only in theirs.</p>
<table><tr><th>deck</th><th>pages</th><th>failing</th><th>worst M</th><th>min SSIM</th></tr>{''.join(rows)}</table>
{''.join(sections)}"""
    out.write_text(page, encoding="utf-8")
    (out.parent / "results.json").write_text(json.dumps([asdict(r) | {"ok": r.ok} for r in results], indent=1))
    return out


def decks_with_reference(decks_root: Path) -> list[Path]:
    """Deck folders that hold a slides.com reference PDF."""
    return sorted(p.parents[2] for p in decks_root.glob("*/.opendeck/reference/slidescom.pdf"))


def run(deck_dirs: list[Path], out_dir: Path, log=print) -> list[DeckResult]:
    from ..export.pdf import export_pdf

    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for deck in deck_dirs:
        ref = deck / ".opendeck" / "reference" / "slidescom.pdf"
        if not ref.is_file():
            log(f"{deck.name}: no reference PDF, skipped")
            continue
        work = out_dir / deck.name
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        ours = export_pdf(deck, work / "ours.pdf")
        r = compare(ours, ref, work, deck.name)
        for png in work.glob("*.png"):  # keep only what the report shows
            stem = png.stem
            if stem.startswith(("ours-", "ref-")) and not (work / f"diff-{int(stem.split('-')[-1]):03d}.png").exists():
                png.unlink()
            elif stem.startswith(("ours-", "ref-")):
                png.rename(work / f"{stem.split('-')[0]}-{int(stem.split('-')[-1]):03d}.png")
        failing = sum(not p.ok for p in r.pages)
        log(f"{deck.name}: {'PASS' if r.ok else 'FAIL'}  pages {r.pages_ours}/{r.pages_ref}, "
            f"{failing} failing, worst M {max((p.m for p in r.pages), default=0):.3%}")
        results.append(r)
    report = write_report(results, out_dir / "index.html")
    log(f"report: {report}")
    return results
