import java.lang.reflect.*;
/**
 * Runs an old TuxGuitar release's reader and writer by reflection (their class names are the
 * same across releases, the model is not). Used by tools/make-legacy-fixtures.sh.
 * Usage: java -cp <old classes> tools/ConvertLegacy.java <reader class> <in> <writer class> <out>
 */
public class ConvertLegacy {
  public static void main(String[] a) throws Exception {
    Object reader = Class.forName(a[0]).getConstructor(String.class).newInstance(a[1]);
    Object song = reader.getClass().getMethod("readSong").invoke(reader);
    Object writer = Class.forName(a[2]).getConstructor(String.class).newInstance(a[3]);
    for (Method m : writer.getClass().getMethods()) {
      if ((m.getName().equals("write") || m.getName().equals("writeSong")) && m.getParameterCount() == 1
          && m.getParameterTypes()[0].isInstance(song)) { m.invoke(writer, song); break; }
    }
    try { writer.getClass().getMethod("close").invoke(writer); } catch (NoSuchMethodException e) {}
    System.out.println("wrote " + a[3]);
  }
}
