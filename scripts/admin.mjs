// Run with Application Default Credentials, never a key committed to this repo.
import { initializeApp } from "../functions/node_modules/firebase-admin/lib/app/index.js";
import { getAuth } from "../functions/node_modules/firebase-admin/lib/auth/index.js";
const [uid, operation, ...args] = process.argv.slice(2);
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (
  !project ||
  !["abakara-baccalaureate-b0758", "demo-abakara"].includes(project)
)
  throw new Error("Set GOOGLE_CLOUD_PROJECT explicitly to the exam project.");
if (!uid || !["admin", "unlimited", "reset-password"].includes(operation))
  throw new Error(
    "Usage: node scripts/admin.mjs UID admin|unlimited|reset-password [true|false]",
  );
initializeApp({ projectId: project });
const auth = getAuth();
const user = await auth.getUser(uid);
if (operation === "reset-password") {
  const password = process.env.NEW_STUDENT_PASSWORD;
  if (!password || password.length < 8)
    throw new Error(
      "Set NEW_STUDENT_PASSWORD (minimum 8 characters) in the environment.",
    );
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
} else {
  if (!["true", "false"].includes(args[0]))
    throw new Error("Specify true or false explicitly.");
  await auth.setCustomUserClaims(uid, {
    ...user.customClaims,
    [operation === "admin" ? "admin" : "unlimitedAttempts"]: args[0] === "true",
  });
}
console.log("Account updated. Ask the user to sign out and sign back in.");
