import {
  EXAM_ID,
  DURATION,
  profile,
  validateExam,
  publicQuestions,
  cleanAnswers,
  grade,
  isBetter,
} from "./domain.js";

// All timestamps are server milliseconds. Injected clock/store make race and
// expiry behavior testable without granting a test process production access.
export function service(db, clock = Date.now) {
  const doc = (p) => db.doc(p);
  const stateRef = (uid) => doc(`students/${uid}/examStates/${EXAM_ID}`);
  const privateRef = (id) => doc(`attemptKeys/${id}`);
  const eventRef = (id) => doc(`notificationQueue/${id}`);
  const entryRef = (uid) => doc(`leaderboards/${EXAM_ID}/entries/${uid}`);
  async function finalize(
    tx,
    ref,
    a,
    key,
    answers,
    submittedAt,
    source,
    essayScores = null,
  ) {
    const result = grade(key.questions, answers, essayScores);
    const entry = {
      ...result,
      uid: a.uid,
      fullName: a.fullName,
      attemptId: ref.id,
      durationSeconds: Math.max(
        0,
        Math.min(DURATION, Math.floor((submittedAt - a.startedAt) / 1000)),
      ),
      submittedAt,
    };
    const oldEntry = await tx.get(entryRef(a.uid));
    const state = await tx.get(stateRef(a.uid));
    const patch = {
      ...result,
      answers,
      submittedAt,
      durationSeconds: entry.durationSeconds,
      source,
    };
    tx.update(ref, patch);
    if (state.data()?.activeId === ref.id)
      tx.update(stateRef(a.uid), { activeId: null, expiresAt: null });
    if (
      result.status === "graded" &&
      isBetter(entry, oldEntry.exists ? oldEntry.data() : null)
    ) {
      const { breakdown, status, ...publicEntry } = entry;
      tx.set(entryRef(a.uid), publicEntry);
    }
    tx.set(eventRef(`${ref.id}-${result.status}`), {
      kind: result.status,
      uid: a.uid,
      fullName: a.fullName,
      score: result.status === "graded" ? result.score : null,
      createdAt: clock(),
      sent: false,
      tries: 0,
    });
    return { ...a, ...patch, id: ref.id };
  }
  return {
    async completeProfile(uid, email, data) {
      const p = profile(data);
      if (email !== `${p.username}@students.abakara.invalid`)
        throw new Error("اسم المستخدم لا يطابق الحساب.");
      return db.runTransaction(async (tx) => {
        const ref = doc(`students/${uid}`),
          name = doc(`usernames/${p.username}`);
        const [student, reserved] = await Promise.all([
          tx.get(ref),
          tx.get(name),
        ]);
        if (reserved.exists && reserved.data().uid !== uid)
          throw new Error("اسم المستخدم مستخدم بالفعل.");
        if (student.exists) return student.data(); // idempotent retry; profile immutable
        tx.set(name, { uid });
        tx.set(ref, { ...p, createdAt: clock() });
        tx.set(eventRef(`registered-${uid}`), {
          kind: "registered",
          uid,
          ...p,
          createdAt: clock(),
          sent: false,
          tries: 0,
        });
        return p;
      });
    },
    async home(uid) {
      const [s, state, exam, attempts] = await Promise.all([
        doc(`students/${uid}`).get(),
        stateRef(uid).get(),
        doc(`exams/${EXAM_ID}`).get(),
        db
          .collection("attempts")
          .where("uid", "==", uid)
          .orderBy("startedAt", "desc")
          .limit(50)
          .get(),
      ]);
      const e = exam.data();
      return {
        profile: s.exists ? s.data() : null,
        state: state.data() ?? { count: 0 },
        exam: {
          id: EXAM_ID,
          title: e?.title ?? "امتحان اللغة العربية",
          published: e?.published === true,
          durationSeconds: DURATION,
          maxAttempts: 3,
          totalMarks: 20,
        },
        attempts: attempts.docs.map((d) => ({ id: d.id, ...d.data() })),
        serverNow: clock(),
      };
    },
    async start(uid, exempt) {
      // Reuse/refinalize an expired active attempt before reserving another slot.
      const previous = await stateRef(uid).get();
      if (previous.data()?.activeId)
        await this.expire(previous.data().activeId);
      return db.runTransaction(async (tx) => {
        const [s, state, ex] = await Promise.all([
          tx.get(doc(`students/${uid}`)),
          tx.get(stateRef(uid)),
          tx.get(doc(`exams/${EXAM_ID}`)),
        ]);
        if (!s.exists) throw new Error("أكمل بيانات الطالب أولًا.");
        const st = state.data() ?? { count: 0 };
        if (st.activeId) return { id: st.activeId };
        const e = ex.data();
        if (!e?.published) throw new Error("الامتحان مغلق حتى اعتماد الأسئلة.");
        validateExam(e);
        if (!exempt && st.count >= 3)
          throw new Error("استنفدت المحاولات الثلاث.");
        const ref = db.collection("attempts").doc(),
          now = clock();
        tx.set(ref, {
          uid,
          fullName: s.data().fullName,
          examId: EXAM_ID,
          version: e.version,
          startedAt: now,
          expiresAt: now + DURATION * 1000,
          status: "active",
          answers: {},
          revision: 0,
        });
        tx.set(privateRef(ref.id), { questions: e.questions });
        tx.set(stateRef(uid), {
          count: st.count + 1,
          activeId: ref.id,
          expiresAt: now + DURATION * 1000,
        });
        return { id: ref.id };
      });
    },
    async getAttempt(uid, id, admin = false) {
      const owner = await doc(`attempts/${id}`).get();
      if (!owner.exists || (!admin && owner.data().uid !== uid))
        throw new Error("المحاولة غير متاحة.");
      if (!admin) await this.expire(id);
      const [a, k] = await Promise.all([
        doc(`attempts/${id}`).get(),
        privateRef(id).get(),
      ]);
      if (!a.exists || (!admin && a.data().uid !== uid))
        throw new Error("المحاولة غير متاحة.");
      const data = {
        id,
        ...a.data(),
        questions: publicQuestions(k.data().questions),
        serverNow: clock(),
      };
      if (admin) data.reviewQuestions = k.data().questions;
      return data;
    },
    async save(uid, id, input, revision, submit = false) {
      return db.runTransaction(async (tx) => {
        const ref = doc(`attempts/${id}`);
        const [snap, key] = await Promise.all([
          tx.get(ref),
          tx.get(privateRef(id)),
        ]);
        const a = snap.data();
        if (!a || a.uid !== uid) throw new Error("المحاولة غير متاحة.");
        if (a.status !== "active")
          return { status: a.status, revision: a.revision };
        const now = clock();
        if (now >= a.expiresAt) {
          const done = await finalize(
            tx,
            ref,
            a,
            key.data(),
            a.answers,
            a.expiresAt,
            "timeout",
          );
          return { status: done.status, revision: a.revision };
        }
        if (!Number.isInteger(revision) || revision !== a.revision)
          throw new Error(
            "تغيّرت الإجابات من تبويب آخر. أعد فتح المحاولة لتحميل آخر حفظ.",
          );
        const answers = cleanAnswers(key.data().questions, input);
        if (submit) {
          const done = await finalize(
            tx,
            ref,
            a,
            key.data(),
            answers,
            now,
            "student",
          );
          return { status: done.status, revision: a.revision };
        }
        tx.update(ref, { answers, revision: a.revision + 1, lastSavedAt: now });
        return { status: "active", revision: a.revision + 1, lastSavedAt: now };
      });
    },
    async expire(id) {
      return db.runTransaction(async (tx) => {
        const ref = doc(`attempts/${id}`);
        const [snap, key] = await Promise.all([
          tx.get(ref),
          tx.get(privateRef(id)),
        ]);
        const a = snap.data();
        if (!a || a.status !== "active" || clock() < a.expiresAt) return false;
        await finalize(
          tx,
          ref,
          a,
          key.data(),
          a.answers,
          a.expiresAt,
          "timeout",
        );
        return true;
      });
    },
    async review(adminUid, id, essayScores) {
      if (
        !essayScores ||
        typeof essayScores !== "object" ||
        Array.isArray(essayScores)
      )
        throw new Error("أدخل درجات المقالي.");
      return db.runTransaction(async (tx) => {
        const ref = doc(`attempts/${id}`);
        const [snap, key] = await Promise.all([
          tx.get(ref),
          tx.get(privateRef(id)),
        ]);
        const a = snap.data();
        if (!a || a.status !== "pending_review")
          throw new Error("المحاولة ليست بانتظار التصحيح.");
        const done = await finalize(
          tx,
          ref,
          a,
          key.data(),
          a.answers,
          a.submittedAt,
          a.source,
          essayScores,
        );
        tx.update(ref, { reviewedBy: adminUid, reviewedAt: clock() });
        return { status: done.status };
      });
    },
    async leaderboard() {
      const s = await db
        .collection(`leaderboards/${EXAM_ID}/entries`)
        .orderBy("score", "desc")
        .orderBy("durationSeconds", "asc")
        .orderBy("submittedAt", "asc")
        .limit(100)
        .get();
      return s.docs.map((d) => {
        const { fullName, score, durationSeconds } = d.data();
        return { fullName, score, durationSeconds };
      });
    },
    async students(after = "") {
      let query = db.collection("students").orderBy("__name__").limit(50);
      if (after) query = query.startAfter(after);
      const s = await query.get();
      const rows = await Promise.all(
        s.docs.map(async (d) => {
          const p = d.data();
          const best = await entryRef(d.id).get();
          return {
            uid: d.id,
            fullName: p.fullName,
            phone: p.phone,
            school: p.school,
            username: p.username,
            lastLoginEventAt: p.lastLoginEventAt ?? null,
            bestScore: best.data()?.score ?? null,
          };
        }),
      );
      return { rows, next: s.docs.length === 50 ? s.docs.at(-1).id : null };
    },
    async pending() {
      const s = await db
        .collection("attempts")
        .where("status", "==", "pending_review")
        .orderBy("submittedAt", "asc")
        .limit(100)
        .get();
      return s.docs.map((d) => ({
        id: d.id,
        fullName: d.data().fullName,
        submittedAt: d.data().submittedAt,
      }));
    },
    async loginEvent(uid) {
      return db.runTransaction(async (tx) => {
        const s = await tx.get(doc(`students/${uid}`));
        if (!s.exists) return {};
        const now = clock();
        if (now - (s.data().lastLoginEventAt ?? 0) < 60000) return {};
        tx.update(s.ref, { lastLoginEventAt: now });
        tx.set(eventRef(`login-${uid}-${Math.floor(now / 60000)}`), {
          kind: "login",
          uid,
          ...s.data(),
          createdAt: now,
          sent: false,
          tries: 0,
        });
        return {};
      });
    },
  };
}
