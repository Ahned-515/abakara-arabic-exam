import test from "node:test";
import assert from "node:assert/strict";
import {
  profile,
  username,
  validateExam,
  cleanAnswers,
  publicQuestions,
  grade,
  isBetter,
} from "../domain.js";
import { student, exam } from "./fixtures.js";
test("normalizes Arabic phone and username", () => {
  assert.equal(profile(student).phone, "01012345678");
  assert.equal(profile(student).username, "student_1");
  assert.equal(
    profile({ ...student, phone: "+20 10 1234 5678" }).phone,
    "01012345678",
  );
});
test("requires four names and valid mobile", () => {
  for (const patch of [
    { fullName: "أحمد" },
    { fullName: "أحمد محمد علي 123" },
    { phone: "0123" },
  ])
    assert.throws(() => profile({ ...student, ...patch }));
  assert.throws(() => username("../test"));
});
test("exam requires 20 questions, reviewed content, duration and total", () => {
  assert.equal(validateExam(exam()).questions.length, 20);
  for (const patch of [
    { reviewed: false },
    { durationSeconds: 30 },
    { questions: exam().questions.slice(1) },
    { totalMarks: 25 },
  ])
    assert.throws(() => validateExam({ ...exam(), ...patch }));
  const e = exam();
  e.questions[1].id = e.questions[0].id;
  assert.throws(() => validateExam(e));
});
test("public questions exclude answer keys and rubrics", () =>
  assert.ok(
    publicQuestions(exam().questions).every(
      (q) => !("correctIndex" in q) && !("rubric" in q),
    ),
  ));
test("reject forged and huge answers", () => {
  const q = exam().questions;
  for (const a of [{ evil: 20 }, { q1: 9 }, { q20: "a".repeat(6001) }])
    assert.throws(() => cleanAnswers(q, a));
  assert.deepEqual(cleanAnswers(q, { q1: 0, q20: "إجابة" }), {
    q1: 0,
    q20: "إجابة",
  });
});
test("essay grading waits for manual review", () => {
  const q = exam().questions;
  assert.equal(grade(q, { q1: 0, q20: "إجابة" }).status, "pending_review");
  assert.equal(grade(q, { q1: 0, q20: "إجابة" }, { q20: 0.5 }).score, 1.5);
  assert.throws(() => grade(q, { q20: "إجابة" }, { q20: 5 }));
  assert.equal(grade(q, {}).status, "graded");
});
test("leaderboard compares grade then time then submission", () => {
  const a = { score: 10, durationSeconds: 100, submittedAt: 50 };
  assert.ok(isBetter(a, null));
  assert.equal(isBetter({ ...a, score: 9 }, a), false);
  assert.ok(isBetter({ ...a, durationSeconds: 99 }, a));
  assert.ok(isBetter({ ...a, submittedAt: 49 }, a));
  assert.equal(isBetter({ ...a }, a), false);
});
