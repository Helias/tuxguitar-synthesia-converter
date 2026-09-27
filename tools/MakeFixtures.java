import java.io.*;
import org.herac.tuxguitar.io.base.TGSongReaderHandle;
import org.herac.tuxguitar.io.base.TGSongWriter;
import org.herac.tuxguitar.io.base.TGSongWriterHandle;
import org.herac.tuxguitar.io.tg.TGSongReaderImpl;
import org.herac.tuxguitar.song.factory.TGFactory;
import org.herac.tuxguitar.song.models.*;

/**
 * Builds the synthetic fixtures in test/fixtures from non-ti-riconosco-piu.tg using TuxGuitar
 * 1.5's own writers, so every file is exactly what TuxGuitar produces:
 *
 *   features.tg          TG 1.5 with repeats, alternate endings, ties, tempo changes, triplet
 *                        feel, let ring, staccato and dead notes (plus the original markers/chords)
 *   features-v1.0.tg …   the same song written by the compat writers for formats 1.0–1.3
 *   features.mid         the same song exported by TuxGuitar's MIDI plugin
 *   features.gp4         the same song exported as Guitar Pro 4 (input for
 *                        tools/make-legacy-fixtures.sh, which needs a format old releases read)
 *
 * Usage (from the project root):
 *   java -cp "/usr/share/tuxguitar/lib/*:/usr/share/tuxguitar/plugins/*" tools/MakeFixtures.java
 */
public class MakeFixtures {
  static final String DIR = "test/fixtures/";

  public static void main(String[] a) throws Exception {
    TGFactory factory = new TGFactory();
    TGSong song = read(factory, DIR + "non-ti-riconosco-piu.tg");
    song.setName("Features");

    // [5 6 |1. 7 :| 2. 8]
    header(song, 5).setRepeatOpen(true);
    header(song, 7).setRepeatAlternative(1);
    header(song, 7).setRepeatClose(1);
    header(song, 8).setRepeatAlternative(1 << 1);
    // |: 21 22 :| x3
    header(song, 21).setRepeatOpen(true);
    header(song, 22).setRepeatClose(2);

    for (int n = 29; n <= 44; n++) header(song, n).getTempo().setValue(120);
    for (int n = 45; n <= song.countMeasureHeaders(); n++) header(song, n).getTempo().setValue(150);
    for (int n = 49; n <= 52; n++) header(song, n).setTripletFeel(TGMeasureHeader.TRIPLET_FEEL_EIGHTH);

    TGTrack guitar = song.getTrack(0);
    TGTrack bass = song.getTrack(1);
    for (int n = 10; n <= 12; n++) tieRepeatedNotes(bass.getMeasure(n - 1));
    for (int n = 13; n <= 14; n++) forEachNote(guitar.getMeasure(n - 1), note -> note.getEffect().setLetRing(true));
    forEachNote(guitar.getMeasure(15 - 1), note -> note.getEffect().setStaccato(true));
    forEachNote(guitar.getMeasure(16 - 1), note -> note.getEffect().setDeadNote(true));

    write(song, new org.herac.tuxguitar.io.tg.TGSongWriterImpl(), DIR + "features.tg");
    write(song, new org.herac.tuxguitar.io.tg.v13.TGSongWriterImpl(), DIR + "features-v1.3.tg");
    write(song, new org.herac.tuxguitar.io.tg.v12.TGSongWriterImpl(), DIR + "features-v1.2.tg");
    write(song, new org.herac.tuxguitar.io.tg.v11.TGSongWriterImpl(), DIR + "features-v1.1.tg");
    write(song, new org.herac.tuxguitar.io.tg.v10.TGSongWriterImpl(), DIR + "features-v1.0.tg");
    write(song, new org.herac.tuxguitar.io.midi.MidiSongWriter(), DIR + "features.mid");
    write(song, new org.herac.tuxguitar.io.gtp.GP4OutputStream(new org.herac.tuxguitar.io.gtp.GTPSettings()), DIR + "features.gp4");
  }

  interface NoteAction { void apply(TGNote note); }

  static TGMeasureHeader header(TGSong song, int number) {
    return song.getMeasureHeader(number - 1);
  }

  static void forEachNote(TGMeasure measure, NoteAction action) {
    for (int b = 0; b < measure.countBeats(); b++) {
      TGVoice voice = measure.getBeat(b).getVoice(0);
      for (int n = 0; n < voice.countNotes(); n++) action.apply(voice.getNote(n));
    }
  }

  /** Ties every note to the previous beat's note on the same string when the fret repeats. */
  static void tieRepeatedNotes(TGMeasure measure) {
    for (int b = 1; b < measure.countBeats(); b++) {
      TGVoice previous = measure.getBeat(b - 1).getVoice(0);
      TGVoice voice = measure.getBeat(b).getVoice(0);
      for (int n = 0; n < voice.countNotes(); n++) {
        TGNote note = voice.getNote(n);
        for (int p = 0; p < previous.countNotes(); p++) {
          TGNote prev = previous.getNote(p);
          if (prev.getString() == note.getString() && prev.getValue() == note.getValue()) note.setTiedNote(true);
        }
      }
    }
  }

  static TGSong read(TGFactory factory, String path) throws Exception {
    TGSongReaderHandle h = new TGSongReaderHandle();
    h.setFactory(factory);
    try (InputStream in = new FileInputStream(path)) {
      h.setInputStream(in);
      new TGSongReaderImpl().read(h);
    }
    return h.getSong();
  }

  static void write(TGSong song, TGSongWriter writer, String path) throws Exception {
    TGSongWriterHandle h = new TGSongWriterHandle();
    h.setFactory(new TGFactory());
    h.setSong(song);
    h.setContext(new org.herac.tuxguitar.io.base.TGSongStreamContext());
    try (OutputStream out = new FileOutputStream(path)) {
      h.setOutputStream(out);
      writer.write(h);
    }
  }
}
