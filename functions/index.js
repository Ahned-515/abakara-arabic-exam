import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { service } from "./service.js";
initializeApp();
const db = getFirestore(),
  api = service(db);
const token = defineSecret("TELEGRAM_BOT_TOKEN"),
  chat = defineSecret("TELEGRAM_CHAT_ID");
const options = {
  region: "europe-west1",
  maxInstances: 10,
  timeoutSeconds: 60,
};
function uid(r) {
  if (!r.auth) throw new HttpsError("unauthenticated", "سجّل الدخول أولًا.");
  return r.auth.uid;
}
function admin(r) {
  const id = uid(r);
  if (r.auth.token.admin !== true)
    throw new HttpsError("permission-denied", "للمشرف فقط.");
  return id;
}
function attemptId(r) {
  const id = r.data?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9]{1,80}$/.test(id))
    throw new HttpsError("invalid-argument", "معرّف غير صحيح.");
  return id;
}
function callable(fn) {
  return onCall(options, async (r) => {
    try {
      return await fn(r);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (e.constructor === Error)
        throw new HttpsError("failed-precondition", e.message);
      throw new HttpsError("internal", "تعذر إتمام الطلب. حاول مجددًا.");
    }
  });
}
export const completeProfile = callable((r) =>
  api.completeProfile(uid(r), r.auth.token.email, r.data),
);
export const home = callable((r) => api.home(uid(r)));
export const startAttempt = callable((r) =>
  api.start(uid(r), r.auth.token.unlimitedAttempts === true),
);
export const getAttempt = callable((r) => api.getAttempt(uid(r), attemptId(r)));
export const saveAnswers = callable((r) =>
  api.save(uid(r), attemptId(r), r.data.answers, r.data.revision),
);
export const submitAttempt = callable((r) =>
  api.save(uid(r), attemptId(r), r.data.answers, r.data.revision, true),
);
export const leaderboard = callable((r) => {
  uid(r);
  return api.leaderboard();
});
export const loginEvent = callable((r) => api.loginEvent(uid(r)));
export const adminStudents = callable((r) => {
  admin(r);
  const after = r.data?.after ?? "";
  if (typeof after !== "string" || after.length > 128 || after.includes("/"))
    throw new HttpsError("invalid-argument", "مؤشر غير صحيح.");
  return api.students(after);
});
export const pendingReviews = callable((r) => {
  admin(r);
  return api.pending();
});
export const adminAttempt = callable((r) =>
  api.getAttempt(admin(r), attemptId(r), true),
);
export const gradeEssay = callable((r) =>
  api.review(admin(r), attemptId(r), r.data.scores),
);
export const expireAttempts = onSchedule(
  { ...options, schedule: "every 1 minutes" },
  async () => {
    const due = await db
      .collection("attempts")
      .where("status", "==", "active")
      .where("expiresAt", "<=", Date.now())
      .limit(200)
      .get();
    await Promise.all(due.docs.map((d) => api.expire(d.id)));
  },
);
// Deploy this optional function only after configuring the two secrets.
// Notifications are at-least-once: a crash after delivery can cause a duplicate.
export const sendNotifications = onSchedule(
  { ...options, schedule: "every 5 minutes", secrets: [token, chat] },
  async () => {
    const events = await db
      .collection("notificationQueue")
      .where("sent", "==", false)
      .limit(100)
      .get();
    for (const item of events.docs) {
      const e = item.data();
      if (e.tries >= 5) {
        await item.ref.update({ sent: true, deliveryFailed: true });
        continue;
      }
      await item.ref.update({ tries: e.tries + 1 });
      const student = await db.doc(`students/${e.uid}`).get();
      const p = student.data() ?? e;
      const text = [
        `عباقرة البكالوريا — ${e.kind}`,
        p.fullName,
        p.username,
        p.phone,
        p.school,
        e.score === null || e.score === undefined
          ? ""
          : `الدرجة: ${e.score}/20`,
      ]
        .filter(Boolean)
        .join("\n");
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token.value()}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chat.value(), text }),
            signal: AbortSignal.timeout(10000),
          },
        );
        const body = await response.json();
        if (response.ok && body.ok)
          await item.ref.update({ sent: true, sentAt: Date.now() });
      } catch {
        /* Retry next scheduled run. Never log tokens or student data. */
      }
    }
  },
);
