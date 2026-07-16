import { describe, expect, it, vi } from "vitest";
import { chooseWorkspaceFolder } from "../src/workspace-selection.js";

describe("chooseWorkspaceFolder", () => {
  it("uses the only folder without prompting", async () => {
    const pick = vi.fn();

    await expect(chooseWorkspaceFolder(["workspace"], pick)).resolves.toBe("workspace");
    expect(pick).not.toHaveBeenCalled();
  });

  it("returns the selected folder in a multi-root workspace", async () => {
    const pick = vi.fn().mockResolvedValue("second");

    await expect(chooseWorkspaceFolder(["first", "second"], pick)).resolves.toBe("second");
  });

  it("does not select a folder when the picker is cancelled", async () => {
    const pick = vi.fn().mockResolvedValue(undefined);

    await expect(chooseWorkspaceFolder(["first", "second"], pick)).resolves.toBeUndefined();
  });
});
