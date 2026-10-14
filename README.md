# opendeck

Free local HTML slide editor, in the spirit of slides.com — https://github.com/corentinravoux/opendeck

- **Decks:** each deck is a folder holding an `index.html` that opens in any browser, a `media/`
  folder with its images, and a small runtime.
- **Editing:** the editor runs in a desktop window. Maths is typeset with KaTeX.
- **Images:** an image dropped or pasted onto a slide is saved into the deck's folder.
- **Export:** HTML and PDF.

Status: **pre-alpha.** The slides.com migration tools, the importer, the deck runtime and
the PDF and HTML exports exist; the editor does not yet. The clean-room rules are in
[CLEANROOM.md](CLEANROOM.md).

## Install

```bash
pip install -e ".[dev]"          # Python >= 3.11
(cd web && npm ci && npm run build)   # builds the deck runtime into src/opendeck/_web/
```

PDF export and migration use Playwright with the system Google Chrome (`channel="chrome"`).
No browser download is needed (`playwright install` is not required).

## Configuration

`~/.config/opendeck/config.toml` is optional. These are the defaults:

```toml
decks_root  = "~/Documents/Slides/decks"          # one folder per deck
export_root = "~/Documents/Slides"                # exports may only go below this folder
mirror_root = "~/.local/share/opendeck/history"   # git history of each deck's index.html
slidescom_user = ""                               # only for `opendeck migrate fetch`
```

## Moving decks out of slides.com

1. Start Chrome with its own profile and a local debugging port, then log in to slides.com in it:

   ```bash
   google-chrome --user-data-dir=/tmp/od-profile --remote-debugging-port=9222 \
                 --remote-debugging-address=127.0.0.1 https://slides.com/users/sign_in
   ```

2. Do a dry run on a throwaway deck. It logs every request that would change something:

   ```bash
   opendeck migrate fetch --only <throwaway-deck> --dry-run --pause 0 --out /tmp/dry
   ```

3. Read `/tmp/dry/requests.log`, then run the batch, allowing only the export endpoint:

   ```bash
   opendeck migrate fetch --allow '^https://slides\.com/api/v1/decks/\d+/exports\.json$'
   opendeck migrate import      # inbox -> <decks_root>/YYYY-MM_<slug>/
   opendeck migrate census      # what the decks contain
   opendeck regress             # our PDF vs the slides.com PDF, per page
   ```

4. Close that Chrome and delete its profile folder, which holds your login cookie.

## Export

```bash
opendeck export pdf  <deck> --out <folder below export_root>
opendeck export html <deck> --out <folder below export_root> [--zip]
```

## Tests

```bash
python -m pytest -q
OPENDECK_EXAMPLES=/path/to/unpacked/exports python -m pytest -q   # also the real-deck tests
```
