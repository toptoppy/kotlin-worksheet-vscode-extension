import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { executeWorksheet } from "../src/executor.js";

const hasKotlinc = spawnSync("kotlinc", ["-version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!hasKotlinc)("executeWorksheet", () => {
  it("runs a Kotlin script worksheet and captures expression output", async () => {
    const result = await executeWorksheet(
      [
        "val a = 40",
        "a + 2",
        "println(\"hello\")",
      ].join("\n"),
      { kotlinCommand: "kotlinc", timeoutMs: 10000 },
    );

    expect(result.success).toBe(true);
    expect(result.results).toEqual(new Map([
      [1, "40"],
      [2, "42"],
    ]));
    expect(result.runtimeOutput).toBe("hello");
  }, 20000);

  it("applies the v0.6.0 result classification rules", async () => {
    const result = await executeWorksheet([
      "fun foo(x: Int): String = x.toString()",
      "val fooRef = ::foo",
      "val lambda = { x: Int -> x.toString() }",
      "val result = lambda(10)",
      "println(result)",
    ].join("\n"), { kotlinCommand: "kotlinc", timeoutMs: 10000 });

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([
      [1, "(Int) -> String"],
      [2, "(Int) -> String"],
      [3, "(Int) -> String"],
      [4, "10"],
    ]));
    expect(result.runtimeOutput).toBe("10");
  }, 20000);

  it("keeps function-type coverage boundaries valid at runtime", async () => {
    const result = await executeWorksheet([
      "val multiply = fun(x: Int, y: Int): Int { return x * y }",
      "data class User(val name: String, val age: Int)",
      "val createUser = ::User",
      "class CallableMultiplier { operator fun invoke(x: Int, y: Int): Int = x * y }",
      "val callable = CallableMultiplier()",
      "val functionAsAny: Any = { value: Int -> value * 2 }",
      "val multiplyResult = multiply(2, 3)",
    ].join("\n"), { kotlinCommand: "kotlinc", timeoutMs: 10000 });

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results.get(1)).toBe("(Int, Int) -> Int");
    expect(result.results.get(3)).toBe("(String, Int) -> User");
    expect(result.results.get(5)).not.toBe("(Int, Int) -> Int");
    expect(result.results.get(6)).not.toBe("(Int) -> Int");
    expect(result.results.get(7)).toBe("6");
  }, 20000);

  it("executes the production orchestration example", async () => {
    const result = await executeWorksheet([
      "fun deleteProduction(target: String): Result<Unit> =",
      "    runCatching {",
      "        println(\"Deleting production $target...\")",
      "    }",
      "",
      "fun orchestrationForDoomDay(",
      "    dangerousThing: () -> Result<Unit>,",
      "    anotherDangerousThing: () -> Result<Unit>",
      "): Result<String> =",
      "    runCatching {",
      "        println(\"Doing something dangerous...\")",
      "        dangerousThing().getOrThrow()",
      "        anotherDangerousThing().getOrThrow()",
      "        println(\"Finished doing something dangerous.\")",
      "        \"All clear... for now.\"",
      "    }",
      "",
      "val deleteProductionDatabase = { deleteProduction(\"Database\") }",
      "val deleteProductionInstance = { deleteProduction(\"Instance\") }",
      "val prepareToDestroy = orchestrationForDoomDay(deleteProductionDatabase, deleteProductionInstance)",
      "val destroyYourOwnProduct = prepareToDestroy",
      "println(destroyYourOwnProduct)",
    ].join("\n"), { kotlinCommand: "kotlinc", timeoutMs: 10000 });

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results.get(1)).toBe("(String) -> Result<Unit>");
    expect(result.results.get(6)).toBe("(() -> Result<Unit>, () -> Result<Unit>) -> Result<String>");
    expect(result.results.get(20)).toBe("Success(All clear... for now.)");
    expect(result.runtimeOutput).toContain("Deleting production Database...");
    expect(result.runtimeOutput).toContain("Finished doing something dangerous.");
  }, 20000);

  it("returns diagnostics for compiler errors", async () => {
    const result = await executeWorksheet("val x = missing", { kotlinCommand: "kotlinc", timeoutMs: 10000 });

    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      sourceLine: 1,
      severity: "error",
    });
  }, 20000);

  it("runs a multiline expression worksheet", async () => {
    const result = await executeWorksheet(
      [
        "listOf(",
        "  1,",
        "  2",
        ").sum()",
      ].join("\n"),
      { kotlinCommand: "kotlinc", timeoutMs: 10000 },
    );

    expect(result.success).toBe(true);
    expect(result.results).toEqual(new Map([[1, "3"]]));
  }, 20000);

  it("runs only the requested range while retaining preceding context", async () => {
    const result = await executeWorksheet([
      "val base = 10",
      "base + 1",
      "base + 2",
      "base + 3",
    ].join("\n"), {
      kotlinCommand: "kotlinc",
      timeoutMs: 10000,
      resultRange: { startLine: 4, endLine: 4 },
    });

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([[4, "13"]]));
  }, 20000);

  it("runs destructuring and multiline lambda worksheets", async () => {
    const result = await executeWorksheet(
      [
        "val (first, second) = Pair(1, 2)",
        "val doubled = listOf(first, second).map { value ->",
        "  value * 2",
        "}",
        "doubled",
      ].join("\n"),
      { kotlinCommand: "kotlinc", timeoutMs: 10000 },
    );

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([
      [1, "[1, 2]"],
      [2, "[2, 4]"],
      [5, "[2, 4]"],
    ]));
  }, 20000);

  it("times out a long-running worksheet", async () => {
    const result = await executeWorksheet("while (true) {}", { kotlinCommand: "kotlinc", timeoutMs: 1000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 15000);

  it("cancels a long-running worksheet", async () => {
    const abortController = new AbortController();
    const promise = executeWorksheet("while (true) {}", {
      kotlinCommand: "kotlinc",
      timeoutMs: 10000,
      cancellationSignal: abortController.signal,
    });

    setTimeout(() => abortController.abort(), 1000);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
  }, 15000);

  it("reports a command start error", async () => {
    const result = await executeWorksheet("val x = 1", {
      kotlinCommand: "definitely-not-a-real-kotlinc-command",
      timeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.startError).toBeTruthy();
  });
});
