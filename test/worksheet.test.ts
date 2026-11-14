import { describe, expect, it } from "vitest";
import {
  applyWorksheetResults,
  findWorksheetRange,
  parseWorksheetResults,
  parseWorksheetOutputDetails,
  formatWorksheetResult,
  instrumentWorksheet,
  isWorksheetPath,
  isWorksheetResultTruncated,
  parseKotlinDiagnostics,
  parseWorksheetOutput,
  stripResultComments,
  stripWorksheetMarkers,
  WORKSHEET_SUFFIXES,
  WORKSHEET_TEMPLATES,
  exportToKotlinFile,
  exportToTestFile,
} from "../src/worksheet.js";

describe("worksheet text handling", () => {
  it("recognizes both .worksheet.kts and .worksheet.kt file paths", () => {
    expect(WORKSHEET_SUFFIXES).toEqual([".worksheet.kts", ".worksheet.kt"]);
    expect(isWorksheetPath("demo.worksheet.kts")).toBe(true);
    expect(isWorksheetPath("/path/to/my.worksheet.kt")).toBe(true);
    expect(isWorksheetPath("C:\\projects\\test.worksheet.kts")).toBe(true);
    expect(isWorksheetPath("C:\\projects\\test.worksheet.kt")).toBe(true);
    expect(isWorksheetPath("Main.kt")).toBe(false);
    expect(isWorksheetPath("script.kts")).toBe(false);
    expect(isWorksheetPath("demo.worksheet.kts.bak")).toBe(false);
  });
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

  it("parses stored result comments by source line", () => {
    expect(parseWorksheetResults("val first = 1 // => 1\nval second = 2 // => 2")).toEqual(new Map([
      [1, "1"],
      [2, "2"],
    ]));
  });

  it("expands a selection to complete worksheet statements", () => {
    const source = [
      "val first = 1",
      "",
      "val second = listOf(",
      "  2,",
      "  3",
      ").sum()",
      "second",
    ].join("\n");

    expect(findWorksheetRange(source, 4, 4)).toEqual({ startLine: 3, endLine: 6 });
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
      "println(\"__MARKER__:start:3\")",
      "println(\"__MARKER__:value:3\")",
      "println(a)",
      "println(\"__MARKER__:end\")",
      "println(\"__MARKER__:start:4\")",
      "val __kotlinWorksheetValue4 = a + 1",
      "println(\"__MARKER__:value:4\")",
      "println(__kotlinWorksheetValue4)",
      "println(\"__MARKER__:end\")",
    ].join("\n"));
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

    expect(instrumented.script).toContain("println(\"__MARKER__:start:1\")");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:5\")");
    expect(instrumented.script).not.toContain("start:2");
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
      "println(\"__MARKER__:start:1\")",
      "val __kotlinWorksheetValue1 = listOf(",
      "  1,",
      "  2,",
      ").sum()",
      "println(\"__MARKER__:value:1\")",
      "println(__kotlinWorksheetValue1)",
      "println(\"__MARKER__:end\")",
    ].join("\n"));
  });

  it("captures println output without printing Unit", () => {
    const instrumented = instrumentWorksheet("println(\"hello\")", "__MARKER__:");

    expect(instrumented.script).toBe("println(\"hello\")");
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
      "println(\"__MARKER__:start:2\")",
      "println(\"__MARKER__:value:2\")",
      "println(text)",
      "println(\"__MARKER__:end\")",
      "println(\"__MARKER__:start:5\")",
      "val __kotlinWorksheetValue5 = text",
      "println(\"__MARKER__:value:5\")",
      "println(__kotlinWorksheetValue5)",
      "println(\"__MARKER__:end\")",
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
      "println(\"__MARKER__:start:1\")",
      "println(\"__MARKER__:value:1\")",
      "println(listOf(first, second))",
      "println(\"__MARKER__:end\")",
      "val doubled = listOf(first, second).map { value ->",
      "  value * 2",
      "}",
      "println(\"__MARKER__:start:2\")",
      "println(\"__MARKER__:value:2\")",
      "println(doubled)",
      "println(\"__MARKER__:end\")",
      "println(\"__MARKER__:start:5\")",
      "val __kotlinWorksheetValue5 = doubled",
      "println(\"__MARKER__:value:5\")",
      "println(__kotlinWorksheetValue5)",
      "println(\"__MARKER__:end\")",
    ].join("\n"));
  });

  it("prints multiline destructuring declarations with nested values", () => {
    const instrumented = instrumentWorksheet([
      "val (",
      "  name,",
      "  scores",
      ") = Pair(\"Ada\", listOf(90, 100))",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println(listOf(name, scores))');
  });

  it("classifies function declarations, references, lambdas, and values", () => {
    const instrumented = instrumentWorksheet([
      "fun foo(x: Int): String = x.toString()",
      "val fooRef = ::foo",
      "val lambda = { x: Int -> x.toString() }",
      "val result = lambda(10)",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println("__MARKER__:value:1")');
    expect(instrumented.script).toContain('println("(Int) -> String")');
    expect(instrumented.script).toContain('println(result)');
    expect(instrumented.script).not.toContain('println(fooRef)');
  });

  it("classifies multiline anonymous function expressions", () => {
    const instrumented = instrumentWorksheet([
      "val multiply = fun(x: Int, y: Int): Int {",
      "  return x * y",
      "}",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println("(Int, Int) -> Int")');
    expect(instrumented.script).not.toContain("println(multiply)");
  });

  it("renders modifier-prefixed function declaration signatures", () => {
    const instrumented = instrumentWorksheet(
      "suspend fun fetch(id: String): String = id",
      "__MARKER__:",
    );

    expect(instrumented.script).toContain('println("suspend fun fetch(id: String): String")');
  });

  it("renders function declaration signatures instead of callable types", () => {
    const instrumented = instrumentWorksheet(
      "fun greet(name: String, excited: Boolean): String = if (excited) \"Hello, $name!\" else \"Hello, $name\"",
      "__MARKER__:",
    );

    expect(instrumented.script).toContain('println("fun greet(name: String, excited: Boolean): String")');
    expect(instrumented.script).not.toContain('println("(String, Boolean) -> String")');
  });

  it("normalizes whitespace in multiline function signatures", () => {
    const instrumented = instrumentWorksheet([
      "fun combine(",
      "  left: String,",
      "  right: String",
      "): String = left + right",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println("fun combine(left: String, right: String): String")');
  });

  it("analyzes references to same-worksheet extension functions", () => {
    const instrumented = instrumentWorksheet([
      "fun String.wordCount(): Int = length",
      "val countWords = String::wordCount",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println("(String) -> Int")');
  });

  it("specializes generic extension references from their receiver type", () => {
    const instrumented = instrumentWorksheet([
      "fun <T> List<T>.firstOrDefault(default: T): T = firstOrNull() ?: default",
      "val stringFirstOrDefault: (List<String>, String) -> String = List<String>::firstOrDefault",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain('println("(List<String>, String) -> String")');
  });

  it("warns when an external function reference has no inferable type", () => {
    const instrumented = instrumentWorksheet("val parseInt = String::toInt", "__MARKER__:");

    expect(instrumented.diagnostics).toEqual([{
      sourceLine: 1,
      sourceColumn: 1,
      severity: "warning",
      message: expect.stringContaining("could not infer the function reference type"),
    }]);
    expect(instrumented.script).not.toContain("println(parseInt)");
  });

  it("uses an explicit type for an external function reference", () => {
    const instrumented = instrumentWorksheet(
      "val parseInt: (String) -> Int = String::toInt",
      "__MARKER__:",
    );

    expect(instrumented.script).toContain('println("(String) -> Int")');
    expect(instrumented.diagnostics).toEqual([]);
  });

  it("warns when a lambda function value has an uninferred return type", () => {
    const instrumented = instrumentWorksheet('val home = { System.getenv("HOME") }', "__MARKER__:");

    expect(instrumented.diagnostics).toEqual([{
      sourceLine: 1,
      sourceColumn: 1,
      severity: "warning",
      message: expect.stringContaining("could not infer the function value type"),
    }]);
    expect(instrumented.script).not.toContain("println(home)");
  });

  it("keeps ordinary control flow and known property references quiet", () => {
    const instrumented = instrumentWorksheet([
      "data class Person(val name: String)",
      "val personName = Person::name",
      "if (personName(Person(\"Ada\")) == \"Ada\") println(\"matched\")",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.diagnostics).toEqual([]);
    expect(instrumented.script).toContain("println(personName)");
    expect(instrumented.script).toContain('println("matched")');
  });

  it("covers Kotlin function-type positives", () => {
    const cases = [
      { source: "val add = { x: Int, y: Int -> x + y }", expected: "(Int, Int) -> Int" },
      { source: "val multiply = fun(x: Int, y: Int): Int { return x * y }", expected: "(Int, Int) -> Int" },
      { source: "fun subtract(x: Int, y: Int): Int = x - y\nval subtractRef = ::subtract", expected: "(Int, Int) -> Int" },
      { source: "val divide: (Int, Int) -> Int = { x, y -> x / y }", expected: "(Int, Int) -> Int" },
      { source: "val currentTime = { System.currentTimeMillis() }", expected: "() -> Long" },
      { source: "val logger = { message: String -> println(message) }", expected: "(String) -> Unit" },
      { source: "val factory = { factor: Int -> { value: Int -> value * factor } }", expected: "(Int) -> (Int) -> Int" },
      { source: "val applyTwice = { value: Int, operation: (Int) -> Int -> operation(operation(value)) }", expected: "(Int, (Int) -> Int) -> Int" },
      { source: "val nullableFunction: ((Int) -> String)? = { it.toString() }", expected: "((Int) -> String)?" },
      { source: "val nullableOperation: ((Int) -> String)? = null", expected: "null", runtime: true },
      { source: "val extension: String.(Int) -> Boolean = { minimum -> length >= minimum }", expected: "String.(Int) -> Boolean" },
      { source: "val fetchUser: suspend (String) -> String = { id -> \"user-$id\" }", expected: "suspend (String) -> String" },
      { source: "fun <T> identity(value: T): T = value\nval intIdentity: (Int) -> Int = ::identity", expected: "(Int) -> Int" },
      { source: "val firstString: (List<String>) -> String = { values -> values.first() }", expected: "(List<String>) -> String" },
      { source: "val flatten = { input: Map<String, List<Int>> -> input.values.flatten() }", expected: "(Map<String, List<Int>>) -> List<Int>" },
      { source: "val findValue = { id: Int -> if (id > 0) id.toString() else null }", expected: "(Int) -> String?" },
      { source: "val nullableParameter = { value: Int? -> value?.toString() ?: \"null\" }", expected: "(Int?) -> String" },
      { source: "val optional = { operation: (() -> Unit)? -> operation?.invoke() }", expected: "((() -> Unit)?) -> Unit" },
      {
        source: [
          "class BoundCalculator(private val factor: Int) {",
          "  fun multiply(value: Int): Int = value * factor",
          "}",
          "val calculator = BoundCalculator(10)",
          "val boundMultiply = calculator::multiply",
        ].join("\n"),
        expected: "(Int) -> Int",
      },
      {
        source: [
          "class UnboundCalculator {",
          "  fun multiply(x: Int, y: Int): Int = x * y",
          "}",
          "val unboundMultiply = UnboundCalculator::multiply",
        ].join("\n"),
        expected: "(UnboundCalculator, Int, Int) -> Int",
      },
      {
        source: [
          "data class User(val name: String, val age: Int)",
          "val createUser = ::User",
        ].join("\n"),
        expected: "(String, Int) -> User",
      },
      {
        source: [
          "class Adder : (Int, Int) -> Int {",
          "  override fun invoke(x: Int, y: Int): Int = x + y",
          "}",
          "val adder = Adder()",
        ].join("\n"),
        expected: "(Int, Int) -> Int",
      },
      { source: "val raw: Any = { value: Int -> value * 2 }\nval cast = raw as (Int) -> Int", expected: "(Int) -> Int" },
      { source: "val captured = { value: Int -> value * 10 }", expected: "(Int) -> Int" },
      { source: "var factor = 10\nval captured = { value: Int -> value * factor }", expected: "(Int) -> Int" },
      { source: "val fail = { message: String -> error(message) }", expected: "(String) -> Nothing" },
      { source: "val alwaysNull = { _: Int -> null }", expected: "(Int) -> Nothing?" },
      { source: "val extension: suspend String.(Int) -> Boolean = { minimum -> length >= minimum }", expected: "suspend String.(Int) -> Boolean" },
      {
        source: "val nested: (Int) -> ((String) -> ((Boolean) -> Double)) = { number -> { text -> { enabled -> if (enabled) number + text.length.toDouble() else 0.0 } } }",
        expected: "(Int) -> (String) -> (Boolean) -> Double",
      },
      {
        source: "fun createMultiplier(factor: Int): (Int) -> Int = { value -> value * factor }\nval triple = createMultiplier(3)",
        expected: "(Int) -> Int",
      },
      { source: "val explicitUnit: (String) -> Unit = { message -> println(message); Unit }", expected: "(String) -> Unit" },
      { source: "suspend fun fetch(id: String): String = id\nval fetchRef = ::fetch", expected: "suspend (String) -> String" },
      { source: "fun convert(value: Int): String = value.toString()\nfun convert(value: Long): String = value.toString()\nval intConverter: (Int) -> String = ::convert", expected: "(Int) -> String" },
      { source: "fun greet(name: String, prefix: String = \"Hello\"): String = \"$prefix $name\"\nval greetRef = ::greet", expected: "(String, String) -> String" },
      { source: "fun sum(vararg values: Int): Int = values.sum()\nval sumRef = ::sum", expected: "(Int) -> Int" },
      { source: "val maybeFactory: (Boolean) -> ((Int) -> Int)? = { enabled -> if (enabled) { { value -> value * 2 } } else null }", expected: "(Boolean) -> ((Int) -> Int)?" },
      { source: "fun multiply(x: Int, y: Int): Int = x * y\nval multiplyAlias = multiply", expected: "(Int, Int) -> Int" },
      { source: "fun multiply(x: Int, y: Int): Int = x * y\nval typedOperation: (Int, Int) -> Int = multiply", expected: "(Int, Int) -> Int" },
      { source: "val listSize: (List<String>) -> Int = { values -> values.size }", expected: "(List<String>) -> Int" },
      { source: "val nullableReceiverLike: (String?, Int) -> Boolean = { value, minimum -> value != null && value.length >= minimum }", expected: "(String?, Int) -> Boolean" },
      { source: "val operationMap = mapOf(\"add\" to { a: Int, b: Int -> a + b })", expected: "(Int, Int) -> Int", runtime: true },
    ];

    for (const testCase of cases) {
      const instrumented = instrumentWorksheet(testCase.source, "__MARKER__:");
      if (testCase.runtime) {
        expect(instrumented.script, testCase.source).toContain("println(");
        expect(instrumented.script, testCase.source).not.toContain(`println(${JSON.stringify(testCase.expected)})`);
      } else {
        expect(instrumented.script, testCase.source).toContain(`println(${JSON.stringify(testCase.expected)})`);
      }
    }
  });

  it("does not classify callable-looking non-function values", () => {
    const cases = [
      {
        source: "class CallableMultiplier { operator fun invoke(x: Int, y: Int): Int = x * y }\nval callable = CallableMultiplier()",
        name: "callable",
        type: "(Int, Int) -> Int",
      },
      {
        source: "data class Person(val name: String)\nval personName = Person::name",
        name: "personName",
        type: "(Person) -> String",
      },
      {
        source: "fun interface Transformer { fun transform(value: Int): String }\nval transformer = Transformer { it.toString() }",
        name: "transformer",
        type: "(Int) -> String",
      },
      {
        source: "val runnable = Runnable { println(\"Hello\") }",
        name: "runnable",
        type: "() -> Unit",
      },
      {
        source: "val functionAsAny: Any = { value: Int -> value * 2 }",
        name: "functionAsAny",
        type: "(Int) -> Int",
      },
      {
        source: "val operations = listOf<(Int, Int) -> Int>({ a, b -> a + b }, { a, b -> a * b })",
        name: "operations",
        type: "(Int, Int) -> Int",
      },
    ];

    for (const testCase of cases) {
      const instrumented = instrumentWorksheet(testCase.source, "__MARKER__:");
      expect(instrumented.script).toContain(`println(${testCase.name})`);
      expect(instrumented.script).not.toContain(`println(${JSON.stringify(testCase.type)})`);
    }
  });

  it("keeps println output outside worksheet results", () => {
    const instrumented = instrumentWorksheet("println(\"hello\")", "__MARKER__:");
    expect(instrumented.script).toBe('println("hello")');
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

  it("separates runtime output from worksheet values", () => {
    expect(parseWorksheetOutputDetails([
      "runtime before",
      "__MARKER__:start:2",
      "side effect",
      "__MARKER__:value:2",
      "42",
      "__MARKER__:end",
      "runtime after",
    ].join("\n"), "__MARKER__:")).toEqual({
      results: new Map([[2, "42"]]),
      runtimeOutput: "runtime before\nside effect\nruntime after",
    });
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

describe("worksheet export and templates", () => {
  it("provides built-in templates with runnable code", () => {
    expect(WORKSHEET_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const ids = WORKSHEET_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("blank");
    expect(ids).toContain("fundamentals");
    expect(ids).toContain("collections");
    expect(ids).toContain("coroutines");
    expect(ids).toContain("arrow");
  });

  it("exports worksheet code to standard Kotlin file with fun main()", () => {
    const worksheet = [
      "package demo.app",
      "",
      "import java.time.Instant",
      "",
      "data class User(val name: String)",
      "",
      "fun greet(u: User) = \"Hello, ${u.name}\"",
      "",
      "val user = User(\"Ada\") // => User(name=Ada)",
      "println(greet(user))",
    ].join("\n");

    const exported = exportToKotlinFile(worksheet);
    expect(exported).toContain("package demo.app");
    expect(exported).toContain("import java.time.Instant");
    expect(exported).toContain("data class User(val name: String)");
    expect(exported).toContain("fun greet(u: User) = \"Hello, ${u.name}\"");
    expect(exported).toContain("fun main() {");
    expect(exported).toContain("    val user = User(\"Ada\")");
    expect(exported).toContain("    println(greet(user))");
    expect(exported).not.toContain("// =>");
  });

  it("exports worksheet code to a Kotlin Test file with assertEquals", () => {
    const worksheet = [
      "package demo.test",
      "",
      "data class Item(val id: Int)",
      "",
      "val x = 40 + 2 // => 42",
      "val item = Item(1) // => Item(id=1)",
      "x * 2 // => 84",
    ].join("\n");

    const exported = exportToTestFile(worksheet);
    expect(exported).toContain("package demo.test");
    expect(exported).toContain("import kotlin.test.Test");
    expect(exported).toContain("import kotlin.test.assertEquals");
    expect(exported).toContain("class WorksheetGeneratedTest {");
    expect(exported).toContain("@Test");
    expect(exported).toContain("fun testWorksheetOutputs() {");
    expect(exported).toContain('assertEquals("42", (x).toString())');
    expect(exported).toContain('assertEquals("Item(id=1)", (item).toString())');
    expect(exported).toContain('assertEquals("84", (x * 2).toString())');
  });
});

describe("Kotlin 2.x and annotation support", () => {
  it("instruments annotated function declarations without printing the annotation", () => {
    const instrumented = instrumentWorksheet([
      "@OptIn(ExperimentalStdlibApi::class)",
      "fun greet(name: String): String = \"Hello, $name\"",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain("@OptIn(ExperimentalStdlibApi::class)");
    expect(instrumented.script).toContain("fun greet(name: String): String = \"Hello, $name\"");
    expect(instrumented.script).not.toContain("println(@OptIn");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:2\")");
    expect(instrumented.script).toContain("println(\"fun greet(name: String): String\")");
  });

  it("instruments annotated variable declarations and attaches result to declaration line", () => {
    const instrumented = instrumentWorksheet([
      "@Suppress(\"UNUSED_VARIABLE\")",
      "val greeting = \"Kotlin 2.x\"",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain("@Suppress(\"UNUSED_VARIABLE\")");
    expect(instrumented.script).toContain("val greeting = \"Kotlin 2.x\"");
    expect(instrumented.script).not.toContain("println(@Suppress");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:2\")");
    expect(instrumented.script).toContain("println(greeting)");
  });

  it("handles Kotlin 2.x context parameters / receivers on declarations", () => {
    const instrumented = instrumentWorksheet([
      "context(ctx: ExecutionContext)",
      "fun compute(): Int = 42",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain("context(ctx: ExecutionContext)");
    expect(instrumented.script).not.toContain("println(context");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:2\")");
    expect(instrumented.script).toContain("println(\"context(ctx: ExecutionContext) fun compute(): Int\")");
  });

  it("handles multiline annotations and multiple annotations", () => {
    const instrumented = instrumentWorksheet([
      "@Deprecated(",
      "  message = \"Use replacement instead\",",
      "  level = DeprecationLevel.WARNING",
      ")",
      "@Suppress(\"DEPRECATION\")",
      "fun legacyCode(): String = \"legacy\"",
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).not.toContain("println(@Deprecated");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:6\")");
    expect(instrumented.script).toContain("println(\"fun legacyCode(): String\")");
  });

  it("handles Kotlin 2.1 multi-dollar string interpolation", () => {
    const instrumented = instrumentWorksheet([
      "val count = 42",
      'val message = $$"""$$count in dollar string"""',
    ].join("\n"), "__MARKER__:");

    expect(instrumented.script).toContain("val count = 42");
    expect(instrumented.script).toContain("println(message)");
    expect(instrumented.diagnostics).toEqual([]);
  });

  it("applies worksheet results cleanly on annotated code lines", () => {
    const source = [
      "@Suppress(\"UNUSED\")",
      "val score = 100",
    ].join("\n");

    const results = new Map<number, string>([[2, "100"]]);
    const applied = applyWorksheetResults(source, results);

    expect(applied).toBe([
      "@Suppress(\"UNUSED\")",
      "val score = 100 // => 100",
    ].join("\n"));
  });

  it("does not instrument closing braces or delimiters as expressions", () => {
    const source = [
      "var total = 0",
      "for (i in 1..10) {",
      "  total += i",
      "}",
      "total",
    ].join("\n");

    const instrumented = instrumentWorksheet(source, "__MARKER__:");
    expect(instrumented.script).not.toContain("val __kotlinWorksheetValue4 = }");
    expect(instrumented.script).not.toContain("println(\"__MARKER__:start:4\")");
    expect(instrumented.script).toContain("println(\"__MARKER__:start:5\")");
  });
});
