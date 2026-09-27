#!/usr/bin/env bash
# Builds TuxGuitar-lib (file format 2.x) from https://github.com/helge17/tuxguitar into
# .tuxguitar-lib/, for tools/golden.mjs to extract golden JSON from TG 2.0 fixtures.
# Needs git, curl, Java 17+ and commons-compress (Debian/Ubuntu: libcommons-compress-java).
set -euo pipefail
cd "$(dirname "$0")/.."
out=.tuxguitar-lib
rm -rf "$out" && mkdir -p "$out"
git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/helge17/tuxguitar.git "$out/src"
git -C "$out/src" sparse-checkout set common/TuxGuitar-lib/src/main/java
curl -sfL -o "$out/commons-io.jar" https://repo1.maven.org/maven2/commons-io/commons-io/2.16.1/commons-io-2.16.1.jar
compress=${COMMONS_COMPRESS_JAR:-/usr/share/java/commons-compress.jar}
java tools/Javac.java "$out/src/common/TuxGuitar-lib/src/main/java" "$out/classes" "$compress:$out/commons-io.jar"
echo "$out/classes:$compress:$out/commons-io.jar" > "$out/classpath"
echo "TuxGuitar-lib built; classpath written to $out/classpath"
