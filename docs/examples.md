# Kotlin Worksheet Examples

## Standalone Worksheet

Create `hello.worksheet.kts` in a trusted workspace:

```kotlin
import kotlin.math.max

val left = 40
val right = 2
max(left, right)
left + right
println("Standalone Kotlin works")
```

Run it with `Kotlin Worksheet: Run` and use `localKotlinc` when the workspace
contains no Gradle project:

```json
{
  "kotlinWorksheet.executionMode": "localKotlinc"
}
```

## Gradle Project

For a standard JVM project, place the worksheet under the project or one of its
subprojects:

```text
sample/
  settings.gradle.kts
  build.gradle.kts
  app/
    build.gradle.kts
    src/main/kotlin/demo/Greeting.kt
    src/test/kotlin/demo/hello.worksheet.kts
```

The extension selects the nearest Gradle project containing the worksheet and
resolves its `main` runtime classpath. Use automatic detection by default:

```json
{
  "kotlinWorksheet.executionMode": "auto"
}
```

Use `gradleClasspath` to require Gradle resolution and report an actionable
error instead of falling back to local Kotlin:

```json
{
  "kotlinWorksheet.executionMode": "gradleClasspath"
}
```

## Render Results

Inline mode writes generated comments:

```kotlin
val answer = 40 + 2 // => 42
```

Decoration mode keeps the source unchanged and displays the result in the
editor. Run `Kotlin Worksheet: Toggle Render Mode` to switch modes.

## Common Setup Failures

- If `kotlinc -version` fails, install Kotlin or configure
  `kotlinWorksheet.kotlinCommand` with an absolute path.
- If automatic Gradle resolution fails, inspect `Kotlin Worksheet: Show Log`;
  the extension reports the fallback reason and continues with local Kotlin.
- If explicit `gradleClasspath` mode fails, verify the wrapper, the selected
  subproject, and its JVM `sourceSets.main.runtimeClasspath`.
- If execution is disabled, trust the workspace before running local code.
