# TuxGuitar → Piano tutorial

A static web app that turns a tab, score or MIDI file into a Synthesia-style falling-notes piano
video. Parsing, synthesis, drawing and encoding all run in the browser; nothing is uploaded.

1. Drop a file.
2. Give each track a role: **Right hand**, **Left hand**, **Both hands** (split at a key you drag
   on the keyboard), **Backing** (heard, not drawn) or **Off**, and set its volume.
3. Tune the video: fall speed, note names (Italian `Do Re Mi` or English), hand colours, lead-in,
   count-in, full keyboard, resolution, soundfont.
4. Preview it with sound; the score (with a playback cursor) is in the collapsible panel below.
5. Export an MP4 (H.264 + AAC; WebM with VP9 + Opus where MP4 encoding is unavailable) and the
   MIDI file.

Roles, split keys and volumes are remembered per file (keyed by the file's SHA-256), video options
globally, in `localStorage`.

## Supported files

| Format                     | Extensions                        | Reader                                                  |
| -------------------------- | --------------------------------- | ------------------------------------------------------- |
| TuxGuitar 0.7–1.5, 2.x     | `.tg`                             | ports of TuxGuitar's readers (`src/app/core/import/tg`) |
| Guitar Pro 3–5, 6, 7–8     | `.gp3` `.gp4` `.gp5` `.gpx` `.gp` | alphaTab                                                |
| MusicXML                   | `.musicxml` `.xml` `.mxl`         | alphaTab                                                |
| Capella                    | `.capx`                           | alphaTab                                                |
| alphaTex                   | `.tex` `.alphatex`                | alphaTab                                                |
| Standard MIDI (format 0/1) | `.mid` `.midi`                    | own parser (`src/app/core/import/midi`)                 |

Formats are detected from the file contents, not the extension. A TuxGuitar 2.x file is a ZIP like
Guitar Pro 7 and `.mxl`, so ZIPs are checked for `version.txt` + `content.xml` first. PowerTab is
not supported. MIDI files have no notation panel.

### Differences from TuxGuitar's own playback

Every score format is sequenced by alphaTab's `MidiFileGenerator`. For TuxGuitar files the tests
check that it plays the same notes at the same ticks as TuxGuitar (see [Tests](#tests)); the
remaining differences are:

- palm-muted notes are slightly longer (alphaTab and TuxGuitar hardcode different lengths);
- let-ring chains stop earlier;
- harmonics, grace notes, trills and tremolo picking follow alphaTab's rules (TuxGuitar, for
  instance, adds a quieter note an octave below a harmonic).

Where TuxGuitar repeats differently from alphaTab (alternate endings spread over several closing
bars), the repeats are written out in TuxGuitar's play order.

## Browser support

Export needs [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API): recent Chrome,
Edge and other Chromium browsers produce MP4. Other browsers produce WebM if they can encode
VP9/VP8 + Opus, otherwise the export panel says export is unavailable (preview and MIDI download
still work). A 2.5-minute song at 1080p30 is ~4,500 frames; expect one to three minutes. The 720p
preset is faster.

## Development

Requires Node 22.

```sh
npm install
npm start            # http://localhost:4200
npm test             # Vitest, single run
npm run lint
npm run format       # Prettier
npm run build        # dist/tuxguitar-synthesia-converter/browser
```

`npm start` and `npm run build` first run `tools/copy-alphatab.mjs`, which copies alphaTab's
worker, worklet, core, music font and the Sonivox soundfont into `.alphatab/`, served from the site
root: alphaTab loads its worker relative to the bundled chunk.

### Layout

```
src/app/core/import/    format detection; TuxGuitar readers → TgSong → alphaTab Score; MIDI parser
src/app/core/sequence/  Score → note events + playable MIDI (one MidiFileGenerator run); tempo map
src/app/core/scene/     note events + roles + options → Scene (seconds, hands, bars, chords, count-in)
src/app/core/render/    drawFrame(ctx, t, scene), shared by preview and export
src/app/core/audio/     offline alphaSynth rendering + count-in clicks
src/app/core/export/    mediabunny: codec probing, frame loop, MP4/WebM muxing
src/app/state/          signal stores: song, preview player (AlphaTabApi), export
src/app/features/       upload, track table, options, preview, notation, export
```

## Tests

`test/fixtures` holds TuxGuitar files in every format version plus, for each, a golden JSON made by
TuxGuitar's own reader and MIDI sequencer. The tests read each file, sequence it with alphaTab and
compare track and measure metadata and every note-on (and note-off, within one tick) with the
golden. The renderer is compared with `test/snapshots/frame-1080p.png` with a pixel tolerance, and
the audio renderer is checked for onset timing, count-in clicks and muting.

| Fixture                                                               | Source                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `non-ti-riconosco-piu.tg` / `.gp5`, `giancane*.tg`                    | study files (TuxGuitar 1.5 and 1.3)                                                                                                                          |
| `features.tg`, `features-v1.0…1.3.tg`, `features.mid`, `features.gp4` | `tools/MakeFixtures.java`: repeats, alternate endings, ties, tempo changes, triplet feel, let ring, staccato and dead notes, written by TuxGuitar 1.5 itself |
| `legacy-v0.7/0.8/0.9.tg`                                              | `tools/make-legacy-fixtures.sh`: the same song written by TuxGuitar 0.7, 0.8 and 0.9.1                                                                       |
| `tg15-reference.tg`, `tg20-*.tg`                                      | TuxGuitar's test resources ([helge17/tuxguitar](https://github.com/helge17/tuxguitar), LGPL-2.1)                                                             |

Regenerating fixtures and goldens needs Java 17+ and TuxGuitar 1.5.x (Debian/Ubuntu package
`tuxguitar`; set `TUXGUITAR_HOME` if it is not in `/usr/share/tuxguitar`):

```sh
java -cp "/usr/share/tuxguitar/lib/*:/usr/share/tuxguitar/plugins/*" tools/MakeFixtures.java
tools/make-legacy-fixtures.sh    # downloads the TuxGuitar 0.7–0.9.1 sources from SourceForge
tools/build-tuxguitar-lib.sh     # builds TuxGuitar-lib 2.x from GitHub, for the 2.x goldens
npm run golden                   # writes test/fixtures/*.golden.json
UPDATE_SNAPSHOTS=1 npm test      # rewrites the renderer snapshot
```

## Deployment

- **GitHub Pages**: `.github/workflows/pages.yml` builds `main` with `--base-href /<repo>/` and
  publishes it; in the repository settings, set Pages → Source to "GitHub Actions".
  `.github/workflows/ci.yml` runs the format check, lint, tests and build on pushes and pull
  requests.
- **Docker**: `docker build -t tuxguitar-synthesia-converter .` then
  `docker run -p 8080:80 tuxguitar-synthesia-converter` serves the app with nginx (gzip, long cache
  for hashed assets, `index.html` not cached).

## Licenses of bundled assets

- [alphaTab](https://alphatab.net): MPL-2.0
- Sonivox GM soundfont, shipped with alphaTab: see its `soundfont/LICENSE`
- Bravura music font: SIL OFL 1.1
- Noto Sans (`@fontsource/noto-sans`): SIL OFL 1.1
- [mediabunny](https://mediabunny.dev): MPL-2.0
