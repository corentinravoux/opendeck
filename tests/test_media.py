import hashlib

from opendeck.deck.media import VIDEO_TYPES, dimensions, media_name, sniff, store

PNG = b"\x89PNG\r\n\x1a\n" + b"\x01" * 16


def test_sniff_ignores_misleading_names():
    assert sniff(PNG, "photo.jpg") == "png"
    assert sniff(b"\xff\xd8\xff\xe0rest", "x.png") == "jpg"
    assert sniff(b"GIF89a....", "") == "gif"
    assert sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ", "") == "webp"
    assert sniff(b"\x00\x00\x00\x1cftypavif", "") == "avif"
    assert sniff(b'  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>', "") == "svg"


def test_sniff_videos():
    assert sniff(b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01", "clip.mp4") == "webm"
    assert sniff(b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00", "clip.webm") == "mp4"
    assert sniff(b"\x00\x00\x00\x18ftypmp42", "") == "mp4"
    assert sniff(b"\x00\x00\x00\x14ftypqt  ", "clip.mov") == "mp4"
    assert sniff(b"\x00\x00\x00\x18ftypheic", "photo.heic") == "heic"  # a still image, not a video
    assert sniff(b"\x00\x00\x00\x1cftypavis", "") == "avif"
    assert sniff(b"????", "clip.MOV") == "mp4"
    assert {"webm", "mp4"} == VIDEO_TYPES


def test_dimensions_of_a_video_is_unknown(tmp_path):
    clip = tmp_path / "a.webm"
    clip.write_bytes(b"\x1a\x45\xdf\xa3")
    assert dimensions(clip) == (None, None)


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
