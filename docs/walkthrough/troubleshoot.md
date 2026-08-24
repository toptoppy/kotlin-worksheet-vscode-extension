# Recover from Errors

Compiler errors appear in the editor and Problems view. Execution details remain in the Kotlin Worksheet log across multiple runs.

## Gradle Classpath Failures

Gradle classpath mode requires a JVM Gradle project that exposes
`sourceSets.main.runtimeClasspath`. Android, Kotlin Multiplatform, and custom
Gradle source-set layouts are unsupported.

Automatic mode tries Gradle when a project is detected. If Gradle classpath
resolution fails, the notification shows the categorized, reason-specific
recovery reason, then execution continues with local Kotlin. The Kotlin
Worksheet Output log contains `kind=<...>` plus the raw Gradle detail. Explicit
`gradleClasspath` mode requires Gradle; its notification reports the
reason-specific error and does not fall back, while the Output log contains the
same structured diagnostics.

Use the notification's recovery reason or the Output log's category to choose a
recovery:

| Failure category | Recovery |
| --- | --- |
| Missing Gradle command | Install Gradle or add a project wrapper. |
| Missing project | Open the worksheet inside a Gradle project, or use local Kotlin. |
| Dependency resolution | Check repositories, dependency declarations, and network access. |
| Unsupported layout | Use a JVM `sourceSets.main.runtimeClasspath` layout or local Kotlin. |
| Timeout | Increase `kotlinWorksheet.timeoutMs` and inspect Gradle performance. |
| Cancelled | Run the worksheet again if the cancellation was unintentional. |
| Empty/generic failure | Open `Kotlin Worksheet: Show Log` for full Gradle output. |

Error notifications provide direct actions for settings, workspace trust, setup
help, Gradle fallback, and logs. Use `Kotlin Worksheet: Check Environment` to
check the configured Kotlin command, execution mode, and Gradle availability.
