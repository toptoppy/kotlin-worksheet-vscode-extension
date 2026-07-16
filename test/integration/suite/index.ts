import Mocha from "mocha";
import path from "node:path";

let ran = false;

export function run(): Promise<void> {
  if (ran) {
    return Promise.resolve();
  }

  ran = true;

  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 60000,
  });

  mocha.addFile(path.resolve(__dirname, "extension.test.js"));

  return new Promise((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
