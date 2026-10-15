# opendeck

Free local HTML slide editor, in the spirit of slides.com — https://github.com/corentinravoux/opendeck

- **Decks:** each deck is a folder holding an `index.html` that opens in any browser, a `media/`
  folder with its images, and a small runtime.
- **Editing:** the editor runs in a desktop window. Maths is typeset with KaTeX.
- **Images:** an image dropped or pasted onto a slide is saved into the deck's folder.
- **Export:** HTML and PDF.

Status: **alpha.** The clean-room rules are in [CLEANROOM.md](CLEANROOM.md).

## Using it

`opendeck` opens the editor window (`opendeck install-desktop` adds it to the application menu);
`opendeck serve --browser` opens the same editor in your browser.

- **Decks:** every deck in your decks folder, by year. Hover a deck and click Duplicate to start a
  new deck from it (slides and images are copied; the copy is filed under this month). Edits save automatically; Ctrl+S also
  records a version in the history (History panel: view or restore any version).
- **Blocks:** click, Shift-click or drag a frame to select; drag to move (with alignment guides),
  handles to resize and rotate; arrow keys nudge; Ctrl+D duplicates; Ctrl+G groups; Ctrl+O switches
  the side panel to the layers.
- **Layout (as in slides.com):** the left rail has All decks, Preview, Undo/Redo, the save state,
  History, Layers, Export, Media and the slide's HTML; next to it, the palette adds text, shapes,
  images, pen, lines, arrows and maths. The slides run along the bottom, with new/duplicate/delete
  on their left. The right panel has three tabs: Design (the selected block), Layers and History.
- **Text:** double-click to type. The toolbar sets font, size, colour, bold/italic/…, lists,
  alignment and links; the Design tab sets them for a whole block. Inline maths: `\( … \)`.
- **Maths:** double-click a maths block and type LaTeX; it renders as you type (KaTeX).
- **Images:** drop or paste them onto a slide, or pick from the images of all your decks. Each
  image is saved into the deck's `media/` folder. The Design tab crops them.
- **Lines, arrows, drawing:** L, A and P, then drag on the slide.
- **Slides:** new, duplicate, delete, drag to reorder in the strip at the bottom. Copy blocks or slides (Ctrl+C) and paste
  them into another deck (Ctrl+V): their images come along.
- **Zoom:** `+`, `−`, `0` (fit), or Ctrl + mouse wheel.
- **Deck:** click its title to rename it. The deck menu (⋯) edits the current slide's HTML
  (Alt+Shift+H), shows the deck folder, or moves the deck to `.trash/` in your decks folder.
- **Theme:** the sun/moon button switches the editor between light and dark.
- **Export:** PDF, HTML folder, HTML zip or one self-contained HTML file, into any folder below
  your export root.

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
opendeck export html <deck> --out <folder below export_root> [--zip | --single]
```

## Tests

```bash
python -m pytest -q
OPENDECK_EXAMPLES=/path/to/unpacked/exports python -m pytest -q   # also the real-deck tests
```

## Credits

Interface type: IBM Plex Sans and Plex Mono (SIL OFL). Icons: Phosphor (MIT).
