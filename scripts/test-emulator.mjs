import { fork, spawn } from "node:child_process";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Local emulators required.");
process.env.GCLOUD_PROJECT = "demo-abakara";
const host = fork("scripts/test-callables.mjs", {
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Test HTTP host did not start")),
      15000,
    );
    host.once("message", () => {
      clearTimeout(timer);
      resolve();
    });
    host.once("exit", (code) =>
      reject(new Error(`Test HTTP host exited ${code}`)),
    );
  });
  const run = (cmd, args) =>
    new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: "inherit" });
      p.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${code}`)),
      );
      p.once("error", reject);
    });
  await run(process.execPath, ["--test", "tests/emulator.test.js"]);
  if (process.argv.includes("--browser"))
    await run("node_modules/.bin/playwright", ["test"]);
} finally {
  host.kill("SIGTERM");
}
