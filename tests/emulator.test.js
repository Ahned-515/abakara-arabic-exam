import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
import {
  initializeApp as initializeAdmin,
  deleteApp as deleteAdmin,
} from "../functions/node_modules/firebase-admin/lib/app/index.js";
import { getFirestore } from "../functions/node_modules/firebase-admin/lib/firestore/index.js";
import { getAuth as getAdminAuth } from "../functions/node_modules/firebase-admin/lib/auth/index.js";
import { exam, student } from "../functions/test/fixtures.js";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error(
    "Run only via npm run test:emulator; production execution is forbidden.",
  );
const projectId = "demo-abakara";
const adminApp = initializeAdmin({ projectId });
const db = getFirestore(adminApp);
const app = initializeApp({
  projectId,
  apiKey: "demo-key",
  authDomain: `${projectId}.firebaseapp.com`,
});
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(app, "europe-west1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const call = async (name, data = {}) =>
  (await httpsCallable(functions, name)(data)).data;
test("real Auth, callable authorization, Firestore transactions and rules", async (t) => {
  try {
    await assert.rejects(
      call("startAttempt"),
      (e) => e.code === "functions/unauthenticated",
    );
    const user = (
      await createUserWithEmailAndPassword(
        auth,
        "student_1@students.abakara.invalid",
        "Test-pass-123",
      )
    ).user;
    await call("completeProfile", student);
    assert.equal((await call("home")).profile.username, "student_1");
    await assert.rejects(
      call("pendingReviews"),
      (e) => e.code === "functions/permission-denied",
    );
    await assert.rejects(
      call("adminStudents"),
      (e) => e.code === "functions/permission-denied",
    );
    await assert.rejects(call("startAttempt")); // missing content must remain closed
    await db.doc("exams/arabic-2026-term1").set(exam());
    const ids = await Promise.all(
      Array.from({ length: 6 }, () => call("startAttempt")),
    );
    const id = ids[0].id;
    assert.equal(new Set(ids.map((r) => r.id)).size, 1);
    let a = await call("getAttempt", { id });
    assert.equal(a.questions.length, 20);
    assert.equal(a.expiresAt - a.startedAt, 1800000);
    assert.ok(
      a.questions.every((q) => !("correctIndex" in q) && !("rubric" in q)),
    );
    assert.equal((await call("home")).state.count, 1);
    const saved = await call("saveAnswers", {
      id,
      answers: { q1: 0, q20: "إجابة" },
      revision: 0,
    });
    assert.equal(saved.revision, 1);
    await assert.rejects(
      call("saveAnswers", { id, answers: { q1: 1 }, revision: 0 }),
    );
    await call("submitAttempt", {
      id,
      answers: { q1: 0, q20: "إجابة" },
      revision: 1,
    });
    await call("submitAttempt", { id, answers: { q1: 1 }, revision: 1 });
    assert.equal((await call("getAttempt", { id })).status, "pending_review");
    assert.equal((await call("leaderboard")).length, 0);
    const token = await user.getIdToken();
    for (const method of ["GET", "PATCH"]) {
      const response = await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/students/${user.uid}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(method === "PATCH"
            ? {
                body: JSON.stringify({
                  fields: { admin: { booleanValue: true } },
                }),
              }
            : {}),
        },
      );
      assert.equal(response.status, 403);
    }
    await getAdminAuth(adminApp).setCustomUserClaims(user.uid, { admin: true });
    await user.getIdToken(true);
    assert.equal((await call("pendingReviews")).length, 1);
    assert.equal((await call("adminStudents")).rows[0].phone, "01012345678");
    await call("gradeEssay", { id, scores: { q20: 0.5 } });
    assert.equal((await call("leaderboard"))[0].score, 1.5);
    const other = initializeApp({ projectId, apiKey: "demo-key" }, "other");
    const otherAuth = getAuth(other);
    connectAuthEmulator(otherAuth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    await createUserWithEmailAndPassword(
      otherAuth,
      "other_user@students.abakara.invalid",
      "Test-pass-123",
    );
    const f = getFunctions(other, "europe-west1");
    connectFunctionsEmulator(f, "127.0.0.1", 5001);
    await assert.rejects(httpsCallable(f, "getAttempt")({ id }));
    await assert.rejects(
      httpsCallable(f, "gradeEssay")({ id, scores: { q20: 1 } }),
    );
    await signOut(otherAuth);
    await deleteApp(other);
    // Force an elapsed deadline using the emulator admin SDK, then verify late answers discarded.
    const second = (await call("startAttempt")).id;
    await call("saveAnswers", { id: second, answers: { q1: 0 }, revision: 0 });
    await db
      .doc(`attempts/${second}`)
      .update({ startedAt: Date.now() - 1800001, expiresAt: Date.now() - 1 });
    await call("submitAttempt", {
      id: second,
      answers: { q1: 1, q2: 0 },
      revision: 1,
    });
    a = await call("getAttempt", { id: second });
    assert.equal(a.score, 1);
    assert.deepEqual(a.answers, { q1: 0 });
    assert.equal(a.durationSeconds, 1800);
    const third = (await call("startAttempt")).id;
    await call("submitAttempt", { id: third, answers: {}, revision: 0 });
    await assert.rejects(call("startAttempt"));
    await getAdminAuth(adminApp).setCustomUserClaims(user.uid, {
      admin: true,
      unlimitedAttempts: true,
    });
    await user.getIdToken(true);
    assert.ok((await call("startAttempt")).id);
    await signOut(auth);
    await signInWithEmailAndPassword(
      auth,
      "student_1@students.abakara.invalid",
      "Test-pass-123",
    );
    assert.equal((await call("home")).state.count, 4);
  } finally {
    await deleteApp(app);
    await deleteAdmin(adminApp);
  }
});
