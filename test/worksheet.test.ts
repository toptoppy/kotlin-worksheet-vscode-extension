import { describe, expect, it } from "vitest";
import {
  applyWorksheetResults,
  formatWorksheetResult,
  instrumentWorksheet,
  isWorksheetResultTruncated,
  parseKotlinDiagnostics,
  parseWorksheetOutput,
  stripResultComments,
  stripWorksheetMarkers,
} from "../src/worksheet.js";

describe("worksheet text handling", () => {
  it("strips only extension result comments", () => {
    const source = [
      "val a = 1 // => 1",
      "val url = \"https://example.com\"",
      "val note = \"// => not a comment\"",
      "val b = 2 // normal comment",
    ].join("\n");

    expect(stripResultComments(source)).toBe([
      "val a = 1",
      "val url = \"https://example.com\"",
      "val note = \"// => not a comment\"",
      "val b = 2 // normal comment",
    ].join("\n"));
  });

  it("applies results to source lines", () => {
    const results = new Map<number, string>([
      [1, "1"],
      [3, "hello\nworld"],
    ]);

    expect(applyWorksheetResults("val a = 1\n\nprintln(\"hello\")", results)).toBe(
      "val a = 1 // => 1\n\nprintln(\"hello\") // => hello\\nworld",
    );
  });

  it("truncates long results with a configurable limit", () => {
    const results = new Map<number, string>([[1, "abcdefghijklmnopqrstuvwxyz"]]);

    expect(applyWorksheetResults("val value = \"x\"", results, { maxResultLength: 10 })).toBe(
      "val value = \"x\" // => abcdefg...",
    );
    expect(isWorksheetResultTruncated("abcdefghijklmnopqrstuvwxyz", 10)).toBe(true);
    expect(isWorksheetResultTruncated("abc", 10)).toBe(false);
  });

  it("formats multiline results for decorations", () => {
    expect(formatWorksheetResult("hello\nworld", 20)).toBe("hello\\nworld");
  });

  it("replaces existing results when applying new ones", () => {
    const results = new Map<number, string>([[1, "2"]]);

    expect(applyWorksheetResults("val a = 1 // => 1", results)).toBe("val a = 1 // => 2");
  });
});

describe("worksheet instrumentation", () => {
  it("adds markers before executable top-level lines", () => {
    const instrumented = instrumentWorksheet(
      [
        "import kotlin.math.max",
        "",
        "val a = 1",
        "a + 1",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(instrumented.script).toBe([
      "import kotlin.math.max",
      "",
      "val a = 1",
      "println(\"__MARKER__:3\")",
      "println(a)",
      "println(\"__MARKER__:4\")",
      "println(a + 1)",
    ].join("\n"));
    expect(instrumented.generatedLineToSourceLine).toEqual([1, 2, 3, 3, 3, 4, 4]);
  });

  it("does not add markers inside a multiline statement", () => {
    const instrumented = instrumentWorksheet(
      [
        "val sum = listOf(",
        "  1,",
        "  2,",
        ").sum()",
        "sum",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(instrumented.script).toContain("println(\"__MARKER__:1\")");
    expect(instrumented.script).toContain("println(\"__MARKER__:5\")");
    expect(instrumented.script).not.toContain("println(\"__MARKER__:2\")");
  });

  it("wraps multiline expressions so their values are printed", () => {
    const instrumented = instrumentWorksheet(
      [
        "listOf(",
        "  1,",
        "  2,",
        ").sum()",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(instrumented.script).toBe([
      "println(\"__MARKER__:1\")",
      "println(listOf(",
      "  1,",
      "  2,",
      ").sum()",
      ")",
    ].join("\n"));
  });

  it("captures println output without printing Unit", () => {
    const instrumented = instrumentWorksheet("println(\"hello\")", "__MARKER__:");

    expect(instrumented.script).toBe([
      "println(\"__MARKER__:1\")",
      "println(\"hello\")",
    ].join("\n"));
  });

  it("keeps multiline strings and block comments out of statement boundaries", () => {
    const instrumented = instrumentWorksheet(
      [
        "/* { this is a comment } */",
        "val text = \"\"\"",
        "  { braces stay in the string }",
        "\"\"\".trimIndent()",
        "text",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(instrumented.script).toBe([
      "/* { this is a comment } */",
      "val text = \"\"\"",
      "  { braces stay in the string }",
      "\"\"\".trimIndent()",
      "println(\"__MARKER__:2\")",
      "println(text)",
      "println(\"__MARKER__:5\")",
      "println(text)",
    ].join("\n"));
  });

  it("prints destructured declarations and waits for multiline lambdas", () => {
    const instrumented = instrumentWorksheet(
      [
        "val (first, second) = Pair(1, 2)",
        "val doubled = listOf(first, second).map { value ->",
        "  value * 2",
        "}",
        "doubled",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(instrumented.script).toBe([
      "val (first, second) = Pair(1, 2)",
      "println(\"__MARKER__:1\")",
      "println(listOf(first, second))",
      "val doubled = listOf(first, second).map { value ->",
      "  value * 2",
      "}",
      "println(\"__MARKER__:2\")",
      "println(doubled)",
      "println(\"__MARKER__:5\")",
      "println(doubled)",
    ].join("\n"));
  });
});

describe("worksheet output parsing", () => {
  it("maps stdout between markers back to source lines", () => {
    const output = [
      "__MARKER__:1",
      "__MARKER__:2",
      "42",
      "__MARKER__:3",
      "hello",
      "world",
      "",
    ].join("\n");

    expect(parseWorksheetOutput(output, "__MARKER__:")).toEqual(new Map([
      [2, "42"],
      [3, "hello\nworld"],
    ]));
  });

  it("removes instrumentation markers from user-visible output", () => {
    const output = [
      "__MARKER__:1",
      "40",
      "__MARKER__:2",
      "hello",
      "world",
      "",
    ].join("\r\n");

    expect(stripWorksheetMarkers(output, "__MARKER__:")).toBe("40\nhello\nworld\n");
  });
});

describe("kotlin diagnostics parsing", () => {
  it("maps generated line numbers back to source line numbers", () => {
    const diagnostics = parseKotlinDiagnostics(
      "/tmp/worksheet.kts:4:5: error: unresolved reference 'missing'.",
      [1, 1, 2, 2],
    );

    expect(diagnostics).toEqual([
      {
        sourceLine: 2,
        sourceColumn: 5,
        severity: "error",
        message: "unresolved reference 'missing'.",
      },
    ]);
  });

  it("maps diagnostics from multiline declarations to their source line", () => {
    const instrumented = instrumentWorksheet(
      [
        "val values = listOf(",
        "  1,",
        "  missingValue,",
        ")",
      ].join("\n"),
      "__MARKER__:",
    );

    expect(parseKotlinDiagnostics(
      "/tmp/worksheet.kts:3:3: error: unresolved reference 'missingValue'.",
      instrumented.generatedLineToSourceLine,
    )).toEqual([
      {
        sourceLine: 3,
        sourceColumn: 3,
        severity: "error",
        message: "unresolved reference 'missingValue'.",
      },
    ]);
  });

  it("parses Kotlin diagnostic prefixes and parenthesized locations", () => {
    expect(parseKotlinDiagnostics(
      [
        "w: /tmp/worksheet.kts: (2, 4): variable is never used",
        "i: /tmp/worksheet.kts:3:2: info: additional context",
      ].join("\n"),
      [1, 2, 3],
    )).toEqual([
      {
        sourceLine: 2,
        sourceColumn: 4,
        severity: "warning",
        message: "variable is never used",
      },
      {
        sourceLine: 3,
        sourceColumn: 2,
        severity: "info",
        message: "additional context",
      },
    ]);
  });
});
