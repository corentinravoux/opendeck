import numpy as np

from opendeck.migrate.regress import ssim, tolerant_mismatch


def page():
    img = np.full((576, 1024), 255, dtype=np.float32)
    img[100:140, 100:600] = 0          # a line of "text"
    img[300:320, 700:720] = 30         # a small shape
    return img


def test_identical():
    a = page()
    assert tolerant_mismatch(a, a) == 0 and ssim(a, a) > 0.999


def test_one_pixel_shift_passes():
    a = page()
    b = np.roll(a, 1, axis=1)
    assert tolerant_mismatch(a, b) == 0


def test_antialias_change_passes():
    a = page()
    b = a.copy()
    b[99, 100:600] = 200              # softened edge
    assert tolerant_mismatch(a, b) < 0.0005


def test_missing_shape_fails():
    a = page()
    b = a.copy()
    b[300:320, 700:720] = 255
    assert tolerant_mismatch(a, b) > 0.0005


def test_reflowed_text_fails():
    a = page()
    b = a.copy()
    b[100:140, 100:600] = 255
    b[150:190, 100:600] = 0
    assert tolerant_mismatch(a, b) > 0.005 and ssim(a, b) < 0.99


def test_decks_with_reference(tmp_path):
    from opendeck.migrate.regress import decks_with_reference

    for name, ref in (("2024-12_a", True), ("2025-01_b", False)):
        d = tmp_path / name / ".opendeck" / "reference"
        d.mkdir(parents=True)
        if ref:
            (d / "slidescom.pdf").write_bytes(b"%PDF-")
    assert decks_with_reference(tmp_path) == [tmp_path / "2024-12_a"]
