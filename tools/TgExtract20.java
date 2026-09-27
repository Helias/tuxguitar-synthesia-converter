import java.io.*;
import java.util.*;
import app.tuxguitar.io.base.TGSongReaderHandle;
import app.tuxguitar.player.base.*;
import app.tuxguitar.song.factory.TGFactory;
import app.tuxguitar.song.managers.TGSongManager;
import app.tuxguitar.song.models.*;

public class TgExtract20 {
  public static void main(String[] a) throws Exception {
    TGFactory factory = new TGFactory();
    TGSong song = read(factory, a[0]);
    TGSongManager sm = new TGSongManager(factory);
    StringBuilder out = new StringBuilder("{\"name\":" + q(song.getName()) + ",\"artist\":" + q(song.getArtist()) + ",\"tracks\":[");
    for (int i = 0; i < song.countTracks(); i++) {
      TGTrack t = song.getTrack(i);
      TGChannel c = sm.getChannel(song, t.getChannelId());
      if (i > 0) out.append(',');
      out.append("{\"number\":" + t.getNumber() + ",\"name\":" + q(t.getName()) + ",\"channelId\":" + t.getChannelId()
        + ",\"program\":" + (c == null ? -1 : c.getProgram()) + ",\"percussion\":" + (c != null && c.isPercussionChannel())
        + ",\"mute\":" + t.isMute() + ",\"measures\":" + t.countMeasures() + "}");
    }
    out.append("],\"headers\":[");
    boolean first = true;
    for (Iterator<TGMeasureHeader> it = song.getMeasureHeaders(); it.hasNext();) {
      TGMeasureHeader mh = it.next();
      if (!first) out.append(','); first = false;
      out.append("{\"n\":" + mh.getNumber() + ",\"start\":" + mh.getStart() + ",\"len\":" + mh.getLength()
        + ",\"tempo\":" + mh.getTempo().getQuarterValue() + ",\"ts\":\"" + mh.getTimeSignature().getNumerator() + "/" + mh.getTimeSignature().getDenominator().getValue() + "\""
        + ",\"repeatOpen\":" + mh.isRepeatOpen() + ",\"repeatClose\":" + mh.getRepeatClose() + ",\"alt\":" + mh.getRepeatAlternative()
        + ",\"marker\":" + (mh.hasMarker() ? q(mh.getMarker().getTitle()) : "null") + "}");
    }
    out.append("],\"events\":[");
    // Sequence every track: the app assigns roles itself, and TuxGuitar 2.x skips muted/non-solo tracks.
    for (int i = 0; i < song.countTracks(); i++) {
      song.getTrack(i).setSolo(false);
      song.getTrack(i).setMute(false);
    }
    List<String> ev = new ArrayList<>();
    MidiSequenceParser p = new MidiSequenceParser(song, sm, 0);
    p.parse(new MidiSequenceHandler(song.countTracks() + 2) {
      public void notifyFinish() {}
      public void addControlChange(long t, int tr, int ch, int c, int v) {}
      public void addTimeSignature(long t, int tr, TGTimeSignature ts) {}
      public void addTrackName(long t, int tr, String name) {}
      public void addProgramChange(long t, int tr, int ch, int v) {}
      public void addPitchBend(long t, int tr, int ch, int v, int voice, boolean b) {}
      public void addNoteOn(long t, int tr, int ch, int k, int v, int voice, boolean b) { ev.add("[\"on\"," + t + "," + tr + "," + ch + "," + k + "," + v + "]"); }
      public void addNoteOff(long t, int tr, int ch, int k, int v, int voice, boolean b) { ev.add("[\"off\"," + t + "," + tr + "," + ch + "," + k + "," + v + "]"); }
      public void addTempoInUSQ(long t, int tr, int usq) { ev.add("[\"tempo\"," + t + "," + tr + ",0," + usq + ",0]"); }
    });
    out.append(String.join(",", ev)).append("]}");
    System.out.println(out);
  }
  static TGSong read(TGFactory factory, String path) throws Exception {
    TGSongReaderHandle h = new TGSongReaderHandle();
    h.setFactory(factory);
    try (InputStream in = new FileInputStream(path)) {
      h.setInputStream(in);
      new app.tuxguitar.io.tg.TGSongReaderImpl().read(h);
    }
    return h.getSong();
  }

  static String q(String s) { return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
}
