# Clean-room rules

opendeck reproduces the *behaviour* of the slides.com editor, and reads and writes the deck
format that slides.com exports. It contains no slides.com code.

## Allowed

- Using the slides.com editor as a normal user, in the author's own account, and recording what
  the UI shows and what HTML each action produces. The resulting spec and screenshots
  are kept outside this repository.
- Reading the deck content of the author's own exports: `index.html`, outside the `<script>`
  that loads the runtime, plus the media files. That content is the author's data.
- Loading an export, as delivered, in a browser, and measuring what it renders: computed styles,
  element rectangles, font metrics. The measured values are facts. They are stored as JSON under
  `web/src/render/theme/measured/`, and our own code generates CSS from them.
  - The browser runs the export's own runtime here, unread, from the export folder or a
    temporary copy of it.
  - Probe elements (headings, lists, a math block…) may be inserted into the rendered page, to
    measure how it styles markup the decks do not happen to contain.
  - Our code never opens, parses or copies the runtime files themselves.
- reveal.js (MIT), KaTeX (MIT), fonts under the OFL or Apache licences from @fontsource or
  Google Fonts.

## Not allowed

- Opening, reading, deobfuscating, copying or bundling anything from an export's `lib/` folder
  (`offline.js`, `offline-v*.css`, `reveal-plugins.js`), or any other slides.com script,
  stylesheet, icon or font file. The importer never extracts `lib/`, and a test enforces it.
- Adding slides.com's built-in icon paths (`symbol-*` shapes) to opendeck's own shape library.
  Paths already inside a user's deck are user data and stay untouched.
- Committing slides.com screenshots to this repository.
