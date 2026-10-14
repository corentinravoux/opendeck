# Visual regression gate

`opendeck regress` renders each imported deck to PDF and compares it, page by page, with the
PDF slides.com produced for the same deck (`<deck>/.opendeck/reference/slidescom.pdf`).

## Metric

Both PDFs are rasterised at 96 dpi in grey, one pixel per CSS pixel.

**M, the tolerant mismatch fraction.**

- A pixel counts as a mismatch when it differs by more than 40/255 from every pixel in the 3×3
  neighbourhood of the same place in the other image.
- M is computed in both directions, and the larger value is kept.
- Anti-aliasing and 1 px shifts do not count. A missing arrow head, equation or line of text does.

## Threshold

| criterion | value | why |
|---|---|---|
| page count | equal | one PDF page per slide |
| M per page | ≤ 1 % | see calibration below |
| SSIM | reported only | about 0.5 on slides with full-page photos, while M stays about 0.2 % and the pages look identical: it measures image resampling, not layout |

## Calibration (2026-10-14, 41 decks, 1433 pages)

| step | worst M | 99th percentile | pages > 1 % |
|---|---|---|---|
| first run, with @fontsource fonts | 6.1 % | 2.4 % | many |
| + font releases matching the decks (Open Sans 1.10, Montserrat 2.001) | 4.2 % | 1.4 % | 47 |
| + nested lists, heading weight | 1.65 % | 0.70 % | 2 |
| + kerning rebuilt into GPOS, list `max-width: 100%` | **0.89 %** | **0.66 %** | **0** |

The median is 0.19 %.

## Known residual differences

All are below 1 %:

- **Monospace text.** "Courier" resolves to a different system font than on the machine that
  rendered the slides.com PDFs, which shifts it by 2–4 px.
- **Inline-mode maths.** Some formulas sit 1–3 px lower or higher, from line-box metrics.
