// Test-only TCP host for the actual onCall HTTP handlers. Useful where local
// Unix sockets (used by the Functions emulator) are unavailable. No mocks.
import express from "express";
if (
  process.env.GCLOUD_PROJECT !== "demo-abakara" ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Local demo emulators are required.");
const handlers = await import("../functions/index.js");
const app = express();
app.use(express.json({ limit: "256kb" }));
app.all("/demo-abakara/europe-west1/:name", (req, res) => {
  const fn = handlers[req.params.name];
  if (!fn?.__endpoint?.callableTrigger) return res.sendStatus(404);
  return fn(req, res);
});
const server = app.listen(5001, "127.0.0.1", () => process.send?.("ready"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
