export async function chooseWorkspaceFolder<T>(
  folders: readonly T[],
  pick: () => PromiseLike<T | undefined>,
): Promise<T | undefined> {
  if (folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return pick();
}
