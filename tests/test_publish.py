import subprocess

import pytest

from opendeck.config import load
from opendeck.deck import publish, store, versioning
from opendeck.export import runtime

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def deck(root, name, title, media=("a.png",)):
    d = store.create(root, title)
    d = d.rename(root / name)
    refs = "".join(f'<img src="media/{m}">' for m in media)
    page = (d / "index.html").read_text(encoding="utf-8").replace("</h2>", f"</h2>{refs}")
    (d / "index.html").write_text(page, encoding="utf-8")
    for m in media:
        (d / "media" / m).write_bytes(PNG + m.encode())
    (d / "media" / "unused.png").write_bytes(PNG)
    return d


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def test_commit_mirrors_used_media_only(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    d = deck(root, "2024-12_demo", "Demo", media=("a.png", "b.png"))
    assert versioning.commit(mirror, d, "first", media=True)
    assert sorted(p.name for p in (mirror / d.name / "media").iterdir()) == ["a.png", "b.png"]
    page = (d / "index.html").read_text(encoding="utf-8").replace('<img src="media/b.png">', "")
    (d / "index.html").write_text(page, encoding="utf-8")
    assert versioning.commit(mirror, d, "drop b", media=True)
    assert sorted(p.name for p in (mirror / d.name / "media").iterdir()) == ["a.png"]
    assert "media/b.png" in git(mirror, "show", "--stat", "--format=", "HEAD")


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_decks_are_private_until_made_public(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    deck(root, "2025-01_internal", "Internal telecon", media=("i.png",))
    commit, names, changed = publish.build(root, mirror)
    assert names == [] and publish.public_decks(mirror) == []
    files = set(git(mirror, "ls-tree", "-r", "--name-only", commit).split())
    assert not any(f.startswith(("2024-12_talk", "2025-01_internal")) for f in files)
    gitignore = git(mirror, "show", f"{commit}:.gitignore")
    assert "/*/" in gitignore and "!/" not in gitignore

    assert publish.set_public(mirror, "2024-12_talk", True)
    assert not publish.set_public(mirror, "2024-12_talk", True)       # already public: no change
    assert git(mirror, "log", "-1", "--format=%s").strip() == "2024-12_talk: public"
    commit, names, changed = publish.build(root, mirror)
    assert changed and names == ["2024-12_talk"]
    files = set(git(mirror, "ls-tree", "-r", "--name-only", commit).split())
    assert {".gitignore", "index.html", ".nojekyll", "README.md", "2024-12_talk/index.html",
            "2024-12_talk/media/a.png", "2024-12_talk/lib/opendeck.js"} <= files
    assert not any("internal" in f or "unused" in f for f in files)
    assert "!/2024-12_talk/" in git(mirror, "show", f"{commit}:.gitignore")
    assert "2024-12_talk/index.html" in git(mirror, "show", f"{commit}:index.html")
    # the private deck is in the local history, never on the published branch
    assert (mirror / "2025-01_internal" / "index.html").is_file()
    assert "internal" not in git(mirror, "log", "--name-only", "--format=", publish.BRANCH)
    assert publish.check(mirror) == commit

    # unchanged: same snapshot; a renamed public deck keeps its place on the whitelist
    assert publish.build(root, mirror)[::2] == (commit, False)
    assert publish.set_public(mirror, "2024-12_talk", True, rename_to="2024-12_new-name")
    assert publish.public_decks(mirror) == ["2024-12_new-name"]
    with pytest.raises(ValueError):
        publish.set_public(mirror, "../x", True)


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_excluded_public_deck_is_still_not_published(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    deck(root, "2026-10_claude-playground", "claude-playground")
    publish.set_public(mirror, "2026-10_claude-playground", True)
    _, names, _ = publish.build(root, mirror, ["*claude-playground"])
    assert names == []


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_push_refuses_a_snapshot_with_a_private_deck(tmp_path):
    mirror, root, remote = tmp_path / "mirror", tmp_path / "decks", tmp_path / "remote.git"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    publish.set_public(mirror, "2024-12_talk", True)
    commit, _, _ = publish.build(root, mirror)
    publish.set_public(mirror, "2024-12_talk", False)                 # made private before the push
    with pytest.raises(publish.PrivateDeckError, match="2024-12_talk"):
        publish.push(mirror, str(remote))
    assert git(remote, "branch", "--list").strip() == ""
    # rebuilt while private: an empty site, which may be pushed
    commit, names, _ = publish.build(root, mirror)
    assert names == []
    publish.push(mirror, str(remote))
    assert git(remote, "rev-parse", "main").strip() == commit
    assert git(remote, "branch", "--list").split() == ["main"]
    # the next snapshot sits on the pushed one: one unpushed commit at most
    publish.set_public(mirror, "2024-12_talk", True)
    new, _, _ = publish.build(root, mirror)
    assert git(mirror, "rev-parse", f"{new}^").strip() == commit


def test_talk_index_escapes_and_groups(tmp_path):
    info = store.DeckInfo("2025-03_x", "<b>Growth</b> & fσ8", 12, 1024, 576, "", "", "", "")
    page = publish.talk_index([info])
    assert "&lt;b&gt;Growth&lt;/b&gt; &amp; fσ8" in page and "<h2>2025</h2>" in page
    assert 'href="2025-03_x/index.html"' in page


def test_publish_config_keys(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('publish_remote = "git@example.org:me/decks.git"\npublish_exclude = ["*_test", "*playground"]\n',
                    encoding="utf-8")
    config = load(path)
    assert config.publish_remote == "git@example.org:me/decks.git"
    assert config.publish_exclude == ("*_test", "*playground")
    assert config.publishing and not load(tmp_path / "none.toml").publishing
    assert load(tmp_path / "none.toml").mirror_media is False
    path.write_text("mirror_media = true\n", encoding="utf-8")
    assert load(path).mirror_media is True
    path.write_text('mirror_media = "yes"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="true or false"):
        load(path)
    path.write_text('publish_exclude = "*_test"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="must be a list"):
        load(path)


def test_mirror_keeps_only_index_without_mirror_media(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    d = deck(root, "2024-12_demo", "Demo")
    assert versioning.commit(mirror, d, "first")
    assert not (mirror / d.name / "media").exists()


def test_visibility_endpoint_only_when_publishing(tmp_path):
    from starlette.testclient import TestClient

    from opendeck.config import Config
    from opendeck.server.app import create_app

    root = tmp_path / "decks"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    deck(root, "2026-10_claude-playground", "playground")
    h = {"X-Opendeck": "1"}
    off = TestClient(create_app(Config(decks_root=root, mirror_root=tmp_path / "m1")), base_url="http://127.0.0.1")
    assert off.get("/api/publishing").json() == {"enabled": False}
    assert "public" not in off.get("/api/decks").json()[0]
    assert off.post("/api/decks/2024-12_talk/visibility", json={"public": True}, headers=h).status_code == 404

    cfg = Config(decks_root=root, mirror_root=tmp_path / "m2", publish_remote="git@example.org:me/d.git",
                 publish_exclude=("*_claude-playground",))
    on = TestClient(create_app(cfg), base_url="http://127.0.0.1")
    assert on.get("/api/publishing").json() == {"enabled": True}
    assert {d["name"]: d["public"] for d in on.get("/api/decks").json()} == {
        "2024-12_talk": False, "2026-10_claude-playground": False}
    assert on.post("/api/decks/2024-12_talk/visibility", json={"public": True}, headers=h).json()["public"]
    assert on.post("/api/decks/2026-10_claude-playground/visibility", json={"public": True},
                   headers=h).status_code == 409
    assert publish.public_decks(cfg.mirror_root) == ["2024-12_talk"]
    r = on.post("/api/decks/2024-12_talk/rename", json={"title": "Renamed talk"}, headers=h)
    assert publish.public_decks(cfg.mirror_root) == [r.json()["name"]] == ["2024-12_renamed-talk"]
    # new decks are private; a copy takes its original's visibility
    new = on.post("/api/decks", json={"title": "Fresh"}, headers=h).json()["name"]
    pub_copy = on.post("/api/decks/2024-12_renamed-talk/duplicate", json={"title": "Copy of public"}, headers=h).json()["name"]
    priv_copy = on.post(f"/api/decks/{new}/duplicate", json={"title": "Copy of private"}, headers=h).json()["name"]
    assert set(publish.public_decks(cfg.mirror_root)) == {"2024-12_renamed-talk", pub_copy}
    assert new not in publish.public_decks(cfg.mirror_root) and priv_copy not in publish.public_decks(cfg.mirror_root)
