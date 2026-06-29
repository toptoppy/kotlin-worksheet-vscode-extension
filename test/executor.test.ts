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
      [3, "hello"],
    ]));
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
        "  2,",
        ").sum()",
      ].join("\n"),
      { kotlinCommand: "kotlinc", timeoutMs: 10000 },
    );

    expect(result.success).toBe(true);
    expect(result.results).toEqual(new Map([[1, "3"]]));
  }, 20000);
});
