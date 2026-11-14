import java.io.*;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Persistent JVM Daemon for Kotlin Worksheet execution.
 * Keeps compiler classes loaded in a warm JVM process to eliminate
 * JVM cold-start latency (< 100ms warm execution).
 */
public class KotlinWorksheetDaemon {
    private static final PrintStream REAL_OUT = System.out;
    private static final PrintStream REAL_ERR = System.err;
    private static Object compilerInstance;
    private static Method execMethod;

    public static void main(String[] args) {
        try {
            // Setup IntelliJ standalone execution environment
            Class<?> compatClass = Class.forName("org.jetbrains.kotlin.cli.jvm.compiler.CompatKt");
            Method setupMethod = compatClass.getMethod("setupIdeaStandaloneExecution");
            setupMethod.invoke(null);

            // Initialize K2JVMCompiler
            Class<?> compilerClass = Class.forName("org.jetbrains.kotlin.cli.jvm.K2JVMCompiler");
            compilerInstance = compilerClass.getDeclaredConstructor().newInstance();
            execMethod = compilerClass.getMethod("exec", PrintStream.class, String[].class);

            // Signal readiness to VS Code client
            REAL_OUT.println("{\"type\":\"ready\",\"version\":\"0.9.0\"}");
            REAL_OUT.flush();

            // Read execution requests from stdin line-by-line
            BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) {
                    continue;
                }

                if (line.contains("\"command\":\"shutdown\"") || line.contains("\"command\": \"shutdown\"")) {
                    REAL_OUT.println("{\"type\":\"shutdown\"}");
                    REAL_OUT.flush();
                    break;
                }

                if (line.contains("\"command\":\"ping\"") || line.contains("\"command\": \"ping\"")) {
                    REAL_OUT.println("{\"type\":\"pong\"}");
                    REAL_OUT.flush();
                    continue;
                }

                handleExecuteRequest(line);
            }
        } catch (Throwable t) {
            REAL_ERR.println("Fatal daemon error: " + t.getMessage());
            t.printStackTrace(REAL_ERR);
            System.exit(1);
        }
    }

    private static void handleExecuteRequest(String jsonLine) {
        long startTime = System.currentTimeMillis();
        String id = extractStringField(jsonLine, "id");
        List<String> compilerArgs = extractStringArray(jsonLine, "args");

        if (compilerArgs.isEmpty()) {
            REAL_OUT.println("{\"id\":" + formatJsonString(id) + ",\"exitCode\":1,\"stdout\":\"\",\"stderr\":\"No args provided\",\"durationMs\":0}");
            REAL_OUT.flush();
            return;
        }

        ByteArrayOutputStream capturedOut = new ByteArrayOutputStream();
        ByteArrayOutputStream capturedErr = new ByteArrayOutputStream();
        PrintStream outStream = new PrintStream(capturedOut, true, StandardCharsets.UTF_8);
        PrintStream errStream = new PrintStream(capturedErr, true, StandardCharsets.UTF_8);

        int exitCodeNum = 1;
        try {
            System.setOut(outStream);
            System.setErr(errStream);
            Object exitCode = execMethod.invoke(compilerInstance, errStream, compilerArgs.toArray(new String[0]));
            String exitCodeStr = exitCode != null ? exitCode.toString() : "INTERNAL_ERROR";
            if ("OK".equalsIgnoreCase(exitCodeStr)) {
                exitCodeNum = 0;
            } else if ("COMPILATION_ERROR".equalsIgnoreCase(exitCodeStr)) {
                exitCodeNum = 1;
            } else {
                exitCodeNum = 2;
            }
        } catch (Throwable t) {
            t.printStackTrace(errStream);
            exitCodeNum = 2;
        } finally {
            System.setOut(REAL_OUT);
            System.setErr(REAL_ERR);
            outStream.flush();
            errStream.flush();
        }

        long duration = System.currentTimeMillis() - startTime;
        String stdoutStr = capturedOut.toString(StandardCharsets.UTF_8);
        String stderrStr = capturedErr.toString(StandardCharsets.UTF_8);

        StringBuilder response = new StringBuilder(stdoutStr.length() + stderrStr.length() + 128);
        response.append("{\"id\":").append(formatJsonString(id))
                .append(",\"exitCode\":").append(exitCodeNum)
                .append(",\"stdout\":").append(formatJsonString(stdoutStr))
                .append(",\"stderr\":").append(formatJsonString(stderrStr))
                .append(",\"durationMs\":").append(duration)
                .append("}");

        REAL_OUT.println(response.toString());
        REAL_OUT.flush();
    }

    static String formatJsonString(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder(value.length() + 16);
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < ' ') {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    static String extractStringField(String json, String key) {
        String pattern = "\"" + key + "\":";
        int idx = json.indexOf(pattern);
        if (idx == -1) {
            pattern = "\"" + key + "\" :";
            idx = json.indexOf(pattern);
        }
        if (idx == -1) {
            return "";
        }
        int start = idx + pattern.length();
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }
        if (start < json.length() && json.charAt(start) == '"') {
            start++;
            StringBuilder sb = new StringBuilder();
            boolean escape = false;
            for (int i = start; i < json.length(); i++) {
                char c = json.charAt(i);
                if (escape) {
                    sb.append(c);
                    escape = false;
                } else if (c == '\\') {
                    escape = true;
                } else if (c == '"') {
                    return sb.toString();
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        } else {
            int end = start;
            while (end < json.length() && json.charAt(end) != ',' && json.charAt(end) != '}') {
                end++;
            }
            return json.substring(start, end).trim();
        }
    }

    static List<String> extractStringArray(String json, String key) {
        List<String> list = new ArrayList<>();
        String pattern = "\"" + key + "\":";
        int idx = json.indexOf(pattern);
        if (idx == -1) {
            pattern = "\"" + key + "\" :";
            idx = json.indexOf(pattern);
        }
        if (idx == -1) {
            return list;
        }
        int start = json.indexOf('[', idx);
        if (start == -1) {
            return list;
        }
        boolean inQuote = false;
        boolean escape = false;
        StringBuilder current = new StringBuilder();
        for (int i = start + 1; i < json.length(); i++) {
            char c = json.charAt(i);
            if (escape) {
                current.append(c);
                escape = false;
            } else if (c == '\\') {
                escape = true;
            } else if (c == '"') {
                if (inQuote) {
                    list.add(current.toString());
                    current.setLength(0);
                    inQuote = false;
                } else {
                    inQuote = true;
                }
            } else if (inQuote) {
                current.append(c);
            } else if (c == ']') {
                break;
            }
        }
        return list;
    }
}
