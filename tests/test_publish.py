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
    # the next snapshot for that destination sits on the one pushed there: one unpushed commit at most
    publish.set_public(mirror, "2024-12_talk", True)
    new, _, _ = publish.build(root, mirror, remote=str(remote))
    assert git(mirror, "rev-parse", f"{new}^").strip() == commit
    # without a destination, a snapshot has no parent
    alone, _, _ = publish.build(root, mirror)
    assert git(mirror, "rev-list", "--parents", "-n", "1", alone).split() == [alone]


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_an_unchanged_snapshot_is_checked_again_before_a_push(tmp_path):
    mirror, root, remote = tmp_path / "mirror", tmp_path / "decks", tmp_path / "remote.git"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    publish.set_public(mirror, "2024-12_talk", True)
    publish.build(root, mirror, remote=str(remote))
    publish.push(mirror, str(remote))
    publish.set_public(mirror, "2024-12_talk", False)
    # branch public is the very snapshot pushed: no unpushed commit, yet it holds a private deck
    with pytest.raises(publish.PrivateDeckError, match="2024-12_talk"):
        publish.push(mirror, str(remote))
    r = subprocess.run(["git", "-C", str(mirror), "push", str(remote), "public:refs/heads/again"],
                       capture_output=True, text=True)
    assert r.returncode != 0 and "not public" in r.stderr


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_a_new_destination_never_receives_older_snapshots(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    a, b = tmp_path / "a.git", tmp_path / "b.git"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    for r in (a, b):
        subprocess.run(["git", "init", "-q", "--bare", str(r)], check=True)
    publish.set_public(mirror, "2024-12_talk", True)
    publish.build(root, mirror, remote=str(a))
    publish.push(mirror, str(a))
    publish.set_public(mirror, "2024-12_talk", False)
    for_a, names, _ = publish.build(root, mirror, remote=str(a))
    assert names == []
    publish.push(mirror, str(a))                    # A had the deck already: only the new tip is checked
    # that snapshot's parent holds the deck: it must not reach B, by push() or by hand
    with pytest.raises(publish.PrivateDeckError, match="2024-12_talk"):
        publish.push(mirror, str(b))
    r = subprocess.run(["git", "-C", str(mirror), "push", str(b), "public:refs/heads/main"],
                       capture_output=True, text=True)
    assert r.returncode != 0 and "not public" in r.stderr
    assert git(b, "branch", "--list").strip() == ""
    # built for B, the snapshot starts afresh, with no parent
    for_b, _, _ = publish.build(root, mirror, remote=str(b))
    assert git(mirror, "rev-list", "--parents", "-n", "1", for_b).split() == [for_b]
    publish.push(mirror, str(b))
    assert "2024-12_talk" not in git(b, "log", "--name-only", "--format=", "main")
    # A's boundary is its own: the next snapshot for A still sits on what A has
    publish.set_public(mirror, "2025-01_other", True)
    deck(root, "2025-01_other", "Other")
    nxt, _, _ = publish.build(root, mirror, remote=str(a))
    assert git(mirror, "rev-parse", f"{nxt}^").strip() == for_a


def test_legacy_boundary_goes_to_the_configured_remote(tmp_path):
    mirror = tmp_path / "mirror"
    versioning.ensure_repo(mirror)
    head = git(mirror, "rev-parse", "HEAD").strip()
    git(mirror, "update-ref", publish.LEGACY_PUSHED, head)
    publish.adopt_legacy_boundary(mirror, "git@example.org:me/d.git")
    assert publish.pushed(mirror, "git@example.org:me/d.git") == head
    assert publish.pushed(mirror, "git@example.org:me/other.git") == ""
    assert subprocess.run(["git", "-C", str(mirror), "rev-parse", "--verify", "-q", publish.LEGACY_PUSHED],
                          capture_output=True).returncode != 0


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_build_with_no_deck_and_no_mirror(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    commit, names, changed = publish.build(root, mirror)
    assert names == [] and changed
    assert "/*/" in git(mirror, "show", f"{commit}:.gitignore")


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_media_are_renormalised_only_when_the_filters_change(tmp_path, monkeypatch):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    publish.set_public(mirror, "2024-12_talk", True)
    calls = []
    real = publish._git
    monkeypatch.setattr(publish, "_git", lambda m, *a, **k: (calls.append(a), real(m, *a, **k))[1])
    renormalised = lambda: sum("--renormalize" in a for a in calls)
    publish.build(root, mirror)
    assert renormalised() == 1                      # first snapshot
    publish.build(root, mirror)
    assert renormalised() == 1                      # unchanged filters: plain `add -A`
    if subprocess.run(["git", "lfs", "version"], capture_output=True).returncode == 0:
        publish.build(root, mirror, lfs=True)
        assert renormalised() == 2                  # LFS turned on: once
        publish.build(root, mirror, lfs=True)
        assert renormalised() == 2


def test_concurrent_visibility_changes_are_not_lost(tmp_path):
    import threading

    mirror = tmp_path / "mirror"
    names = [f"2024-{m:02d}_talk" for m in range(1, 13)]
    publish.set_public(mirror, names[0], True)
    barrier = threading.Barrier(len(names))

    def flip(i, name):
        barrier.wait()
        publish.set_public(mirror, name, i % 2 == 1)  # the first (public) goes private, others alternate

    threads = [threading.Thread(target=flip, args=(i, n)) for i, n in enumerate(names)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert publish.public_decks(mirror) == [n for i, n in enumerate(names) if i % 2 == 1]
    assert git(mirror, "status", "--porcelain").strip() == ""


def test_trashed_public_deck_passes_no_visibility_on(tmp_path):
    from starlette.testclient import TestClient

    from opendeck.config import Config
    from opendeck.server.app import create_app

    root = tmp_path / "decks"
    root.mkdir()
    cfg = Config(decks_root=root, mirror_root=tmp_path / "m", publish_remote="git@example.org:me/d.git")
    c = TestClient(create_app(cfg), base_url="http://127.0.0.1")
    h = {"X-Opendeck": "1"}
    name = c.post("/api/decks", json={"title": "Talk"}, headers=h).json()["name"]
    assert c.post(f"/api/decks/{name}/visibility", json={"public": True}, headers=h).json()["public"]
    assert c.delete(f"/api/decks/{name}", headers=h).status_code == 200
    assert publish.public_decks(cfg.mirror_root) == []
    # the same title, the same month: another folder name (that one has a history), private
    again = c.post("/api/decks", json={"title": "Talk"}, headers=h).json()["name"]
    assert again != name and publish.public_decks(cfg.mirror_root) == []
    assert {d["name"]: d["public"] for d in c.get("/api/decks").json()} == {again: False}


def test_a_stale_whitelist_entry_is_never_inherited(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    d = store.create(root, "Talk")
    publish.set_public(mirror, d.name, True)        # public, never committed, then deleted by hand
    import shutil

    shutil.rmtree(d)
    assert store.create(root, "Talk", mirror=mirror).name != d.name
    other = store.create(root, "Other", mirror=mirror)
    renamed = store.rename(root, other, "Talk", mirror)
    assert renamed.name != d.name
    # renaming a private deck onto a stale public entry does not make it public
    publish.set_public(mirror, "2024-01_private", True, rename_to=d.name)
    assert d.name not in publish.public_decks(mirror)


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


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
@pytest.mark.skipif(subprocess.run(["git", "lfs", "version"], capture_output=True).returncode != 0, reason="no git-lfs")
def test_lfs_snapshot_holds_pointers_and_a_pages_workflow(tmp_path):
    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    publish.set_public(mirror, "2024-12_talk", True)
    plain, _, _ = publish.build(root, mirror)                       # first without LFS: plain blobs
    blob = subprocess.run(["git", "-C", str(mirror), "show", f"{plain}:2024-12_talk/media/a.png"],
                          check=True, capture_output=True).stdout
    assert blob.startswith(b"\x89PNG")
    commit, _, changed = publish.build(root, mirror, lfs=True)
    assert changed
    pointer = git(mirror, "show", f"{commit}:2024-12_talk/media/a.png")
    assert pointer.startswith("version https://git-lfs.github.com/spec/v1")
    assert "filter=lfs" in git(mirror, "show", f"{commit}:.gitattributes")
    assert "deploy-pages" in git(mirror, "show", f"{commit}:.github/workflows/pages.yml")
    assert "2024-12_talk/media/a.png" in git(mirror, "lfs", "ls-files", "--name-only", commit)
    assert publish.check(mirror) == commit                          # .github is not a deck folder


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_pre_push_hook_lets_only_the_public_snapshot_out(tmp_path):
    mirror, root, remote = tmp_path / "mirror", tmp_path / "decks", tmp_path / "remote.git"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    deck(root, "2025-01_internal", "Internal")
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    publish.set_public(mirror, "2024-12_talk", True)
    publish.build(root, mirror)
    head = git(mirror, "symbolic-ref", "--short", "HEAD").strip()
    # a hand-typed push of the history (every deck, private ones included) is refused
    r = subprocess.run(["git", "-C", str(mirror), "push", str(remote), f"{head}:refs/heads/main"],
                       capture_output=True, text=True)
    assert r.returncode != 0 and "only the website snapshot" in r.stderr
    # so is a snapshot holding a deck made private since it was built
    publish.set_public(mirror, "2024-12_talk", False)
    r = subprocess.run(["git", "-C", str(mirror), "push", str(remote), "public:refs/heads/main"],
                       capture_output=True, text=True)
    assert r.returncode != 0 and "not public" in r.stderr
    assert git(remote, "branch", "--list").strip() == ""
    publish.set_public(mirror, "2024-12_talk", True)
    publish.push(mirror, str(remote))
    assert git(remote, "branch", "--list").split() == ["main"]
    assert "internal" not in git(remote, "log", "--name-only", "--format=", "main")


@pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
def test_talks_json_thumbnails_and_redirect(tmp_path):
    import json

    mirror, root = tmp_path / "mirror", tmp_path / "decks"
    root.mkdir()
    deck(root, "2024-12_talk", "A talk")
    publish.set_public(mirror, "2024-12_talk", True)
    commit, _, _ = publish.build(root, mirror, title="Talks", index_url="https://example.org/talks.html")
    data = json.loads(git(mirror, "show", f"{commit}:talks.json"))
    talk = data["talks"][0]
    assert (talk["name"], talk["title"], talk["date"], talk["url"]) == (
        "2024-12_talk", "A talk", "2024-12", "2024-12_talk/index.html")
    assert 'http-equiv="refresh" content="0; url=https://example.org/talks.html"' in git(mirror, "show", f"{commit}:index.html")
    if talk["thumb"]:                       # rendered only where a system Chrome is installed
        assert talk["thumb"] == "2024-12_talk/thumb.webp"
        assert "2024-12_talk/thumb.webp" in git(mirror, "ls-tree", "-r", "--name-only", commit)
        assert publish.check(mirror) == commit


def test_cli_imports_follow_mirror_media(tmp_path, monkeypatch):
    import argparse

    from opendeck import cli
    from opendeck.config import Config
    from opendeck.importer import slidescom
    from opendeck.migrate import batch

    seen = []
    monkeypatch.setattr(cli, "load", lambda: Config(decks_root=tmp_path, mirror_root=tmp_path / "m", mirror_media=True))
    monkeypatch.setattr(versioning, "MIRROR_MEDIA", False)
    monkeypatch.setattr(slidescom, "import_export", lambda *a, **k: seen.append(versioning.MIRROR_MEDIA) or
                        slidescom.ImportReport(folder="x"))
    monkeypatch.setattr(batch, "run", lambda *a, **k: seen.append(versioning.MIRROR_MEDIA) or 0)
    cli._import(argparse.Namespace(export=tmp_path / "e.zip", folder=None, pdf=None, force=False))
    monkeypatch.setattr(versioning, "MIRROR_MEDIA", False)
    cli._migrate_import(argparse.Namespace(force=False))
    assert seen == [True, True]
