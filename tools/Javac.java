import java.nio.file.*;
import java.util.*;
import java.util.stream.*;
import javax.tools.*;

/**
 * Compiles every .java file under a directory (javac is not always installed; the JDK compiler
 * module used by the `java File.java` launcher is). Usage: java tools/Javac.java <srcDir> <outDir> <classpath>
 */
public class Javac {
  public static void main(String[] a) throws Exception {
    List<String> args = new ArrayList<>(List.of("-nowarn", "-d", a[1], "-cp", a[2]));
    try (Stream<Path> s = Files.walk(Path.of(a[0]))) {
      s.filter(p -> p.toString().endsWith(".java")).forEach(p -> args.add(p.toString()));
    }
    System.exit(ToolProvider.getSystemJavaCompiler().run(null, null, null, args.toArray(new String[0])));
  }
}
