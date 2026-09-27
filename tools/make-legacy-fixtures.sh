#!/usr/bin/env bash
# Writes test/fixtures/legacy-v0.{7,8,9}.tg with the original TuxGuitar 0.7, 0.8 and 0.9.1
# writers (from their SourceForge source releases), converting test/fixtures/features.gp4.
# Only the IO and song model are compiled; GUI/player classes they touch are stubbed.
# Needs curl and Java 17+. Run tools/MakeFixtures.java first if features.gp4 is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
work=.tuxguitar-legacy
fixtures=test/fixtures
mkdir -p "$work"

build() {
  local version=$1 out=$work/$1
  local src=$work/TuxGuitar-$version-src/src/org/herac/tuxguitar
  [ -d "$out/classes" ] && return
  curl -sfL -o "$work/$version.tar.gz" \
    "https://sourceforge.net/projects/tuxguitar/files/TuxGuitar/TuxGuitar-$version/TuxGuitar-$version-src.tar.gz/download"
  tar xzf "$work/$version.tar.gz" -C "$work"
  local dst=$out/src/org/herac/tuxguitar
  mkdir -p "$dst/io" "$out/classes"
  cp -r "$src/song" "$dst/"
  cp -r "$src/io/tg" "$src/io/gp" "$dst/io/"
  cp "$src"/io/*.java "$dst/io/"
  [ -d "$src/io/pt" ] && cp -r "$src/io/pt" "$dst/io/"
  local util
  util=$(find "$src/gui" -name TablatureUtil.java | head -1)
  mkdir -p "$dst/$(dirname "${util#"$src"/}")"
  cp "$util" "$dst/${util#"$src"/}"
  mkdir -p "$dst/gui" "$dst/play/models/defaultplayer"
  printf 'package org.herac.tuxguitar.gui;\npublic class TuxGuitar { public static final String TUXGUITAR_VERSION = "0.9"; }\n' \
    > "$dst/gui/TuxGuitar.java"
  printf 'package org.herac.tuxguitar.play.models;\npublic interface Player { javax.sound.midi.Soundbank getDefaultSoundbank(); javax.sound.midi.Soundbank getSoundbank(); void reset(); }\n' \
    > "$dst/play/models/Player.java"
  printf 'package org.herac.tuxguitar.play.models.defaultplayer;\npublic class SongPlayer implements org.herac.tuxguitar.play.models.Player { public SongPlayer(Object o) {} public javax.sound.midi.Soundbank getDefaultSoundbank() { return null; } public javax.sound.midi.Soundbank getSoundbank() { return null; } public void reset() {} }\n' \
    > "$dst/play/models/defaultplayer/SongPlayer.java"
  java tools/Javac.java "$out/src" "$out/classes" .
}

for version in 0.7 0.8 0.9.1; do
  build "$version"
  short=${version%.1}
  java -cp "$work/$version/classes" tools/ConvertLegacy.java \
    org.herac.tuxguitar.io.gp.GP4InputStream "$fixtures/features.gp4" \
    org.herac.tuxguitar.io.tg.TGOutputStream "$fixtures/legacy-v$short.tg"
done
