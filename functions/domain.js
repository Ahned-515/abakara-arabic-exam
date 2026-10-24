export const EXAM_ID = "arabic-2026-term1";
export const DURATION = 1800;
export const LIMIT = 3;
export function fail(message) {
  throw new Error(message);
}
export function username(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{3,30}$/.test(value))
    fail("اسم المستخدم: 3–30 حرفًا إنجليزيًا أو رقمًا أو _.");
  return value.toLowerCase();
}
export function profile(data) {
  const fullName = String(data?.fullName ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const school = String(data?.school ?? "").trim();
  const phone = String(data?.phone ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[\s()-]/g, "")
    .replace(/^(?:\+20|0020)/, "0");
  if (
    fullName.length > 100 ||
    fullName.split(" ").length < 4 ||
    fullName.split(" ").some((w) => !/^[\p{L}\p{M}]+$/u.test(w))
  )
    fail("أدخل الاسم الرباعي بالحروف.");
  if (school.length < 2 || school.length > 120)
    fail("أدخل اسم المدرسة من 2 إلى 120 حرفًا.");
  if (!/^01[0125]\d{8}$/.test(phone)) fail("أدخل رقم محمول مصري صحيحًا.");
  return { fullName, school, phone, username: username(data.username) };
}
export function validateExam(exam) {
  if (!exam || !Array.isArray(exam.questions) || exam.questions.length !== 20)
    fail("يلزم 20 سؤالًا.");
  if (
    exam.durationSeconds !== DURATION ||
    exam.maxAttempts !== LIMIT ||
    exam.totalMarks !== 20
  )
    fail("الإعداد المعتمد: 30 دقيقة، 3 محاولات، 20 درجة.");
  if (exam.reviewed !== true) fail("يجب مراجعة واعتماد محتوى الامتحان أولًا.");
  const topics = new Set();
  const ids = new Set();
  let marks = 0;
  for (const q of exam.questions) {
    if (!/^[a-z0-9_-]{1,50}$/i.test(q.id) || ids.has(q.id))
      fail("معرّف السؤال مكرر أو غير صحيح.");
    ids.add(q.id);
    topics.add(q.topic);
    if (
      typeof q.text !== "string" ||
      !q.text.trim() ||
      q.text.length > 12000 ||
      !Number.isFinite(q.marks) ||
      q.marks <= 0
    )
      fail("نص السؤال أو درجته غير صحيح.");
    marks += q.marks;
    if (q.type === "mcq") {
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 6 ||
        q.options.some((o) => typeof o !== "string" || !o.trim()) ||
        !Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex >= q.options.length
      )
        fail("اختيارات السؤال أو مفتاحه غير صحيح.");
    } else if (q.type === "essay") {
      if (typeof q.rubric !== "string" || !q.rubric.trim())
        fail("يلزم معيار تصحيح للمقالي.");
    } else fail("نوع سؤال غير مدعوم.");
  }
  if (Math.abs(marks - 20) > 1e-8) fail("مجموع الدرجات يجب أن يساوي 20.");
  if (
    !["النحو", "البلاغة", "القراءة", "النصوص", "القصة"].every((t) =>
      topics.has(t),
    )
  )
    fail("يلزم تغطية الموضوعات الخمسة.");
  if (
    !exam.questions.some((q) => q.type === "essay") ||
    !exam.questions.some((q) => q.type === "mcq")
  )
    fail("يلزم اختيار من متعدد ومقالي.");
  return exam;
}
export function publicQuestions(questions) {
  return questions.map(({ id, type, text, topic, marks, options }) => ({
    id,
    type,
    text,
    topic,
    marks,
    ...(type === "mcq" ? { options } : {}),
  }));
}
export function cleanAnswers(questions, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("الإجابات غير صحيحة.");
  const result = {};
  for (const key of Object.keys(input))
    if (!questions.some((q) => q.id === key)) fail("سؤال غير موجود.");
  for (const q of questions) {
    const a = input[q.id];
    if (a === undefined || a === null || a === "") continue;
    if (q.type === "mcq") {
      if (!Number.isInteger(a) || a < 0 || a >= q.options.length)
        fail("إجابة اختيار غير صحيحة.");
    } else if (typeof a !== "string" || a.length > 6000)
      fail("الإجابة المقالية أطول من الحد المسموح.");
    result[q.id] = a;
  }
  return result;
}
export function grade(questions, answers, essayScores = null) {
  let score = 0;
  let pending = false;
  const breakdown = {};
  for (const q of questions) {
    let points;
    if (q.type === "mcq")
      points = answers[q.id] === q.correctIndex ? q.marks : 0;
    else if (!String(answers[q.id] ?? "").trim()) points = 0;
    else if (essayScores === null) {
      points = null;
      pending = true;
    } else {
      points = essayScores[q.id];
      if (!Number.isFinite(points) || points < 0 || points > q.marks)
        fail("درجة مقالية خارج المدى.");
    }
    breakdown[q.id] = points;
    score += points ?? 0;
  }
  return { score, breakdown, status: pending ? "pending_review" : "graded" };
}
export function isBetter(a, b) {
  return (
    !b ||
    a.score > b.score ||
    (a.score === b.score &&
      (a.durationSeconds < b.durationSeconds ||
        (a.durationSeconds === b.durationSeconds &&
          a.submittedAt < b.submittedAt)))
  );
}
export function canStart(state, exempt, now) {
  if (state?.activeId && state.expiresAt > now) return "resume";
  if (!exempt && (state?.count ?? 0) >= LIMIT) return "limit";
  return "start";
}
