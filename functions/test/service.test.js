import test from "node:test";
import assert from "node:assert/strict";
import { service } from "../service.js";
import { MemoryDB } from "./memory.js";
import { exam, student } from "./fixtures.js";
import { EXAM_ID } from "../domain.js";
async function setup() {
  const db = new MemoryDB();
  let now = 1000000;
  const api = service(db, () => now);
  db.data.set(`exams/${EXAM_ID}`, exam());
  await api.completeProfile("u", "student_1@students.abakara.invalid", student);
  return { db, api, advance: (n) => (now += n) };
}
test("profile retry and username uniqueness", async () => {
  const { api } = await setup();
  await assert.rejects(
    api.completeProfile("v", "wrong@students.abakara.invalid", student),
  );
  await assert.rejects(
    api.completeProfile("v", "student_1@students.abakara.invalid", student),
  );
  assert.equal(
    (
      await api.completeProfile(
        "u",
        "student_1@students.abakara.invalid",
        student,
      )
    ).username,
    "student_1",
  );
});
test("simultaneous starts reserve one active attempt", async () => {
  const { api, db } = await setup();
  const ids = await Promise.all(
    Array.from({ length: 8 }, () => api.start("u", false)),
  );
  assert.equal(new Set(ids.map((x) => x.id)).size, 1);
  assert.equal(db.data.get(`students/u/examStates/${EXAM_ID}`).count, 1);
});
test("fourth rejected, explicit exemption allows it", async () => {
  const { api } = await setup();
  for (let i = 0; i < 3; i++) {
    const { id } = await api.start("u", false);
    await api.save("u", id, {}, 0, true);
  }
  await assert.rejects(api.start("u", false), /الثلاث/);
  assert.ok((await api.start("u", true)).id);
});
test("stale tab cannot overwrite saved answers", async () => {
  const { api, db } = await setup();
  const { id } = await api.start("u", false);
  await api.save("u", id, { q1: 0 }, 0);
  await assert.rejects(api.save("u", id, { q1: 1 }, 0), /تبويب/);
  assert.equal(db.data.get(`attempts/${id}`).answers.q1, 0);
});
test("expiry drops late answers and uses saved ones", async () => {
  const { api, db, advance } = await setup();
  const { id } = await api.start("u", false);
  await api.save("u", id, { q1: 0 }, 0);
  advance(1800001);
  await api.save("u", id, { q1: 1, q2: 0 }, 1, true);
  const a = db.data.get(`attempts/${id}`);
  assert.deepEqual(a.answers, { q1: 0 });
  assert.equal(a.score, 1);
  assert.equal(a.durationSeconds, 1800);
  assert.equal(a.source, "timeout");
});
test("duplicate submit is idempotent", async () => {
  const { api, db } = await setup();
  const { id } = await api.start("u", false);
  await api.save("u", id, { q1: 0 }, 0, true);
  await api.save("u", id, { q2: 0 }, 0, true);
  assert.equal(db.data.get(`attempts/${id}`).score, 1);
});
test("essay excluded until one-time admin review", async () => {
  const { api, db } = await setup();
  const { id } = await api.start("u", false);
  await api.save("u", id, { q1: 0, q20: "إجابة" }, 0, true);
  assert.equal(db.data.get(`attempts/${id}`).status, "pending_review");
  assert.equal(db.data.has(`leaderboards/${EXAM_ID}/entries/u`), false);
  await assert.rejects(api.review("admin", id, null));
  await assert.rejects(api.review("admin", id, { q20: 9 }));
  await api.review("admin", id, { q20: 0.5 });
  assert.equal(db.data.get(`leaderboards/${EXAM_ID}/entries/u`).score, 1.5);
  await assert.rejects(api.review("admin", id, { q20: 1 }));
});
test("closed exam blocks new attempt but permits resume", async () => {
  const { api, db } = await setup();
  const { id } = await api.start("u", false);
  db.data.get(`exams/${EXAM_ID}`).published = false;
  assert.equal((await api.start("u", false)).id, id);
  await api.save("u", id, {}, 0, true);
  await assert.rejects(api.start("u", false), /مغلق/);
});
test("cross-student submit is refused", async () => {
  const { api } = await setup();
  const { id } = await api.start("u", false);
  await assert.rejects(api.save("v", id, { q1: 0 }, 0, true));
});
