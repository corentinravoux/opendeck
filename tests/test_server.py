import re

import pytest
from starlette.testclient import TestClient

from opendeck.config import Config
from opendeck.importer.slidescom import import_export
from opendeck.server.app import create_app
from opendeck.server.host import Host


def _png() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (2, 1), (255, 0, 0)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()
W = {"x-opendeck": "1"}


class FakeHost(Host):
    def __init__(self, answer=None):
        self.answer, self.revealed = answer, []

    def pick_folder(self, start):
        return self.answer

    def reveal(self, path):
        self.revealed.append(path)


@pytest.fixture
def env(make_export, decks_root, tmp_path):
    export_root = decks_root.parent
    (export_root / "Talks é" / "2026").mkdir(parents=True)
    config = Config(decks_root=decks_root, export_root=export_root, mirror_root=tmp_path / "mirror")
    name = import_export(make_export(), decks_root).folder
    host = FakeHost(answer=export_root / "Talks é")
    client = TestClient(create_app(config, host, allowed_hosts={"testserver"}))
    return client, config, name, host


def test_guards(env):
    client, _, name, _ = env
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/health", headers={"host": "evil.example:80"}).status_code == 403
    assert client.post(f"/api/decks/{name}/media", content=PNG).status_code == 403  # no X-Opendeck


def test_list_and_read(env):
    client, _, name, _ = env
    decks = client.get("/api/decks").json()
    assert [d["name"] for d in decks] == [name] and decks[0]["slides"] == 2
    deck = client.get(f"/api/decks/{name}").json()
    assert deck["meta"]["title"] == "Démo deck" and "<section" in deck["slides"] and deck["etag"]
    assert client.get("/api/decks/..%2Fetc").status_code in (400, 404)
    assert client.get("/api/decks/_inbox").status_code == 400


def test_upload_saves_into_deck_media(env):
    client, config, name, _ = env
    r = client.post(f"/api/decks/{name}/media", content=PNG,
                    headers=W | {"content-type": "image/png", "x-filename": "Figure%20%C3%A9.png"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["src"].startswith("media/") and body["width"] == 2 and body["height"] == 1
    assert (config.decks_root / name / body["src"]).read_bytes() == PNG
    again = client.post(f"/api/decks/{name}/media", content=PNG, headers=W).json()
    assert again["deduped"] and again["src"] == body["src"]
    assert client.post(f"/api/decks/{name}/media", content=b"not an image", headers=W).status_code == 415


def test_upload_accepts_videos(env):
    client, config, name, _ = env
    webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
    r = client.post(f"/api/decks/{name}/media", content=webm, headers=W | {"content-type": "video/webm", "x-filename": "hdr_A.webm"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["src"].startswith("media/") and body["src"].endswith(".webm")
    assert body["width"] is None and body["height"] is None
    served = client.get(f"/view/{name}/{body['src']}", headers={"range": "bytes=0-3"})
    assert served.status_code == 206 and served.content == webm[:4]  # seeking needs range requests
    assert served.headers["content-type"] == "video/webm"


def test_view_serves_deck_files_only(env):
    client, _, name, _ = env
    page = client.get(f"/view/{name}/")
    assert page.status_code == 200 and "opendeck-meta" in page.text
    media_src = client.get(f"/api/decks/{name}").json()["slides"].split('src="')[1].split('"')[0]
    assert client.get(f"/view/{name}/{media_src}").status_code == 200
    assert client.get(f"/view/{name}/.opendeck/import-report.json").status_code == 404
    assert client.get(f"/view/{name}/../../etc/passwd").status_code == 404


def test_dirs_and_pick_folder(env):
    client, config, _, host = env
    listing = client.get("/api/fs/dirs").json()
    assert "Talks é" in listing["children"] and config.decks_root.name not in listing["children"]
    assert client.get("/api/fs/dirs", params={"path": "/etc"}).status_code == 400
    picked = client.post("/api/host/pick-folder", json={}, headers=W).json()
    assert picked["path"].endswith("Talks é")
    host.answer = config.decks_root  # a folder inside the decks folder is refused
    assert client.post("/api/host/pick-folder", json={}, headers=W).status_code == 400


def test_export_html_and_remember(env):
    client, config, name, host = env
    dest = config.export_root / "Talks é" / "2026"
    r = client.post(f"/api/decks/{name}/export", headers=W,
                    json={"kind": "html", "dir": str(dest), "name": "my talk", "zip": True})
    assert r.status_code == 200, r.text
    assert (dest / "my talk.zip").is_file()
    assert client.post(f"/api/decks/{name}/export", headers=W,
                       json={"kind": "html", "dir": str(dest), "name": "my talk", "zip": True}).status_code == 409
    remembered = client.get(f"/api/decks/{name}/exports").json()
    assert remembered[0]["dir"] == str(dest) and remembered[0]["zip"] is True
    bad = client.post(f"/api/decks/{name}/export", headers=W, json={"kind": "pdf", "dir": "/tmp"})
    assert bad.status_code == 400
    client.post("/api/host/reveal", json={"path": str(dest / "my talk.zip")}, headers=W)
    assert host.revealed == [dest]


def test_save_with_etag_and_history(env):
    client, config, name, _ = env
    deck = client.get(f"/api/decks/{name}").json()
    slides = deck["slides"].replace("Croissance", "Growth")
    r = client.put(f"/api/decks/{name}", headers=W, json={"slides": slides, "etag": deck["etag"], "commit": True})
    assert r.status_code == 200, r.text
    assert r.json()["committed"] is True
    again = client.get(f"/api/decks/{name}").json()
    assert "Growth" in again["slides"] and again["etag"] == r.json()["etag"]
    assert again["meta"]["title"] == "Démo deck"
    stale = client.put(f"/api/decks/{name}", headers=W, json={"slides": slides, "etag": deck["etag"]})
    assert stale.status_code == 409
    bad = client.put(f"/api/decks/{name}", headers=W, json={"slides": "<p>no slides</p>", "etag": again["etag"]})
    assert bad.status_code == 400
    from opendeck.deck import versioning
    assert versioning.log(config.mirror_root, name)[0][2] == f"{name}: edit"


def test_historian_debounces(tmp_path, make_export, decks_root):
    from opendeck.deck import versioning
    from opendeck.deck.store import Historian

    name = import_export(make_export(), decks_root).folder
    deck = decks_root / name
    h = Historian(tmp_path / "mirror", interval_s=600)
    page = deck / "index.html"
    assert h.saved(deck, now=0)                      # first save commits
    page.write_text(page.read_text().replace("Croissance", "A"))
    assert not h.saved(deck, now=60)                 # within 10 min: pending
    page.write_text(page.read_text().replace("A", "B", 1))
    assert h.saved(deck, now=61, force=True)         # Ctrl+S commits at once
    page.write_text(page.read_text().replace("B", "C", 1))
    h.saved(deck, now=62)
    h.flush(now=63)                                  # shutdown commits what is pending
    assert len(versioning.log(tmp_path / "mirror", name)) == 3


def test_media_copy_between_decks(env, make_export):
    client, config, name, _ = env
    other = import_export(make_export(deck_id=7, slug="other-deck"), config.decks_root).folder
    src_media = sorted((config.decks_root / name / "media").iterdir())[0]
    rel = f"media/{src_media.name}"
    (config.decks_root / other / rel).unlink()
    r = client.post(f"/api/decks/{other}/media/copy", headers=W, json={"from": name, "srcs": [rel, rel]})
    assert r.status_code == 200 and r.json()["copied"] == [rel]
    assert (config.decks_root / other / rel).read_bytes() == src_media.read_bytes()
    again = client.post(f"/api/decks/{other}/media/copy", headers=W, json={"from": name, "srcs": [rel]}).json()
    assert again["copied"] == []
    bad = client.post(f"/api/decks/{other}/media/copy", headers=W, json={"from": name, "srcs": ["../index.html"]})
    assert bad.status_code == 400


def test_history_list_view_restore(env):
    client, config, name, _ = env
    deck = client.get(f"/api/decks/{name}").json()
    first = client.put(f"/api/decks/{name}", headers=W, json={"slides": deck["slides"], "etag": deck["etag"], "commit": True})
    v1 = client.get(f"/api/decks/{name}/history").json()[0]["rev"]
    changed = deck["slides"].replace("Croissance", "Version deux")
    client.put(f"/api/decks/{name}", headers=W, json={"slides": changed, "etag": first.json()["etag"], "commit": True})
    versions = client.get(f"/api/decks/{name}/history").json()
    assert len(versions) == 2 and versions[1]["rev"] == v1
    old = client.get(f"/history/{name}/{v1}/")
    assert old.status_code == 200 and "Croissance" in old.text and f'<base href="/view/{name}/">' in old.text
    assert client.get(f"/history/{name}/nothex/").status_code == 404
    assert client.post(f"/api/decks/{name}/history/{v1}/restore", headers=W).status_code == 200
    assert "Croissance" in client.get(f"/api/decks/{name}").json()["slides"]
    messages = [v["message"] for v in client.get(f"/api/decks/{name}/history").json()]
    # the version being replaced was already recorded, so no extra "before restoring" commit is needed
    assert messages[0].endswith(f"restored {v1[:7]}") and len(messages) == 3


def test_library_and_thumbnails(env, monkeypatch, tmp_path):
    client, config, name, _ = env
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    items = client.get("/api/library").json()
    assert items and items[0]["deck"] == name and items[0]["src"].startswith("media/")
    assert items[0]["title"] == "Démo deck"
    big = config.decks_root / name / "media" / "big.png"
    from PIL import Image
    Image.new("RGB", (1200, 600), (10, 20, 30)).save(big)
    r = client.get(f"/api/thumb/{name}/big.png", params={"w": 240})
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    import io
    assert Image.open(io.BytesIO(r.content)).size == (240, 120)
    assert client.get(f"/api/thumb/{name}/..%2Findex.html").status_code == 404


def test_new_deck(env):
    client, config, _, _ = env
    r = client.post("/api/decks", headers=W, json={"title": "Réunion de groupe: P1D"})
    assert r.status_code == 200
    name = r.json()["name"]
    assert re.fullmatch(r"\d{4}-\d{2}_reunion-de-groupe-p1d", name)
    deck = client.get(f"/api/decks/{name}").json()
    assert deck["meta"]["title"] == "Réunion de groupe: P1D" and "<h2>Réunion de groupe: P1D</h2>" in deck["slides"]
    again = client.post("/api/decks", headers=W, json={"title": "Réunion de groupe: P1D"}).json()["name"]
    assert again == name + "-2"
    assert client.post("/api/decks", headers=W, json={"title": "  "}).status_code == 400


def test_duplicate_deck(env):
    client, config, name, _ = env
    src = config.decks_root / name
    (src / ".opendeck").mkdir(exist_ok=True)
    (src / ".opendeck" / "state.json").write_text("{}")
    assert client.post(f"/api/decks/{name}/duplicate", json={"title": "Copie"}).status_code == 403  # needs X-Opendeck
    r = client.post(f"/api/decks/{name}/duplicate", headers=W, json={"title": "Séminaire: copie"})
    assert r.status_code == 200
    new = r.json()["name"]
    assert re.fullmatch(r"\d{4}-\d{2}_seminaire-copie", new)
    copy, orig = client.get(f"/api/decks/{new}").json(), client.get(f"/api/decks/{name}").json()
    assert copy["meta"]["title"] == "Séminaire: copie" and copy["slides"] == orig["slides"]
    assert sorted(p.name for p in (config.decks_root / new / "media").iterdir()) == sorted(p.name for p in (src / "media").iterdir())
    assert (config.decks_root / new / "lib").is_dir() == (src / "lib").is_dir()
    assert not (config.decks_root / new / ".opendeck").exists()
    assert client.post(f"/api/decks/{name}/duplicate", headers=W, json={"title": " "}).status_code == 400
    assert client.post("/api/decks/nope/duplicate", headers=W, json={"title": "x"}).status_code == 404
    assert len(client.get("/api/decks").json()) == 2


def test_rename_and_trash(env):
    client, config, name, _ = env
    deck = client.get(f"/api/decks/{name}").json()
    r = client.put(f"/api/decks/{name}", headers=W, json={"slides": deck["slides"], "etag": deck["etag"], "meta": {"title": "Nouveau titre"}})
    assert r.status_code == 200
    assert client.get(f"/api/decks/{name}").json()["meta"]["title"] == "Nouveau titre"
    assert "<title>Nouveau titre</title>" in (config.decks_root / name / "index.html").read_text(encoding="utf-8")
    assert client.delete(f"/api/decks/{name}").status_code == 403  # needs X-Opendeck
    gone = client.delete(f"/api/decks/{name}", headers=W)
    assert gone.status_code == 200 and not (config.decks_root / name).exists()
    assert list((config.decks_root / ".trash").iterdir())[0].name.startswith(name)
    assert client.get("/api/decks").json() == []


def test_rename_deck_endpoint(env):
    client, config, name, _ = env
    deck = client.get(f"/api/decks/{name}").json()
    # an edit still pending in the Historian is recorded before the folder moves
    client.put(f"/api/decks/{name}", headers=W, json={"slides": deck["slides"], "etag": deck["etag"], "commit": True})
    deck = client.get(f"/api/decks/{name}").json()
    client.put(f"/api/decks/{name}", headers=W, json={"slides": deck["slides"].replace("Croissance", "Pending"), "etag": deck["etag"]})
    assert client.post(f"/api/decks/{name}/rename", json={"title": "x"}).status_code == 403  # needs X-Opendeck
    assert client.post(f"/api/decks/{name}/rename", headers=W, json={"title": " "}).status_code == 400
    assert client.post(f"/api/decks/{name}/rename", headers=W, json={"title": "???"}).status_code == 400
    r = client.post(f"/api/decks/{name}/rename", headers=W, json={"title": "Renommé: v2"})
    assert r.status_code == 200, r.text
    new = r.json()["name"]
    assert new == f"{name[:7]}_renomme-v2" and not (config.decks_root / name).exists()
    got = client.get(f"/api/decks/{new}").json()
    assert got["meta"]["title"] == "Renommé: v2" and got["etag"] == r.json()["etag"] and "Pending" in got["slides"]
    messages = [v["message"] for v in client.get(f"/api/decks/{new}/history").json()]
    assert messages == [f"{name} -> {new}: rename", f"{name}: edit", f"{name}: edit"]
    # a window still open on the old name is told where the deck went
    old = client.get(f"/api/decks/{name}")
    assert old.status_code == 404 and old.json()["moved"] == new
    stale = client.put(f"/api/decks/{name}", headers=W, json={"slides": got["slides"], "etag": got["etag"]})
    assert stale.status_code == 404 and stale.json()["moved"] == new
    assert client.post("/api/decks/nope/rename", headers=W, json={"title": "x"}).status_code == 404
