import hashlib

from opendeck.deck.media import media_name, sniff, store

PNG = b"\x89PNG\r\n\x1a\n" + b"\x01" * 16


def test_sniff_ignores_misleading_names():
    assert sniff(PNG, "photo.jpg") == "png"
    assert sniff(b"\xff\xd8\xff\xe0rest", "x.png") == "jpg"
    assert sniff(b"GIF89a....", "") == "gif"
    assert sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ", "") == "webp"
    assert sniff(b"\x00\x00\x00\x1cftypavif", "") == "avif"
    assert sniff(b'  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>', "") == "svg"


def test_sniff_falls_back_to_suffix():
    assert sniff(b"????", "Figure.JPEG") == "jpg"
    assert sniff(b"????", "noext") == "bin"


def test_name_is_content_hash():
    assert media_name(PNG, "a.png") == hashlib.sha256(PNG).hexdigest()[:20] + ".png"


def test_store_dedups(tmp_path):
    rel, existed = store(tmp_path, PNG, "a.png")
    assert rel.startswith("media/") and not existed
    assert (tmp_path / rel).read_bytes() == PNG
    rel2, existed2 = store(tmp_path, PNG, "other-name.png")
    assert rel2 == rel and existed2
    assert len(list((tmp_path / "media").iterdir())) == 1
