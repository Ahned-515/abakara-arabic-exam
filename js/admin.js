import { auth, configured, call, watch, errorText } from "./client.js";
const $ = (id) => document.getElementById(id);
let attempt;
const n = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
function message(text) {
  $("message").textContent = text;
}
async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    message(errorText(e));
  }
}
async function list() {
  const rows = await call("pendingReviews");
  $("list").replaceChildren();
  for (const r of rows) {
    const b = n(
      "button",
      `${r.fullName} — ${new Date(r.submittedAt).toLocaleString("ar-EG")}`,
    );
    b.onclick = () => guard(() => open(r.id));
    $("list").append(b);
  }
  if (!rows.length)
    $("list").append(n("p", "لا توجد إجابات بانتظار المراجعة."));
}
async function open(id) {
  attempt = await call("adminAttempt", { id });
  $("review").hidden = false;
  $("student").textContent = attempt.fullName;
  $("questions").replaceChildren();
  for (const q of attempt.reviewQuestions) {
    const box = n("div");
    box.className = "review";
    box.append(n("h3", q.text));
    const answer = attempt.answers[q.id];
    const p = n(
      "p",
      answer === undefined
        ? "بلا إجابة"
        : q.type === "mcq"
          ? q.options[answer]
          : answer,
    );
    p.className = "answerText";
    box.append(p);
    if (q.type === "essay") {
      box.append(n("p", `معيار التصحيح: ${q.rubric}`));
      const label = n("label", `الدرجة من ${q.marks}`),
        input = n("input");
      input.type = "number";
      input.id = `score-${q.id}`;
      input.min = 0;
      input.max = q.marks;
      input.step = "any";
      input.required = true;
      if (!String(answer ?? "").trim()) {
        input.value = 0;
        input.readOnly = true;
      }
      label.htmlFor = input.id;
      box.append(label, input);
    } else
      box.append(
        n("p", `درجة الاختيار: ${attempt.breakdown[q.id]} / ${q.marks}`),
      );
    $("questions").append(box);
  }
}
$("reviewForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!confirm("اعتماد هذه الدرجات ونشر النتيجة في لوحة الشرف؟")) return;
  const scores = {};
  for (const q of attempt.reviewQuestions)
    if (q.type === "essay") scores[q.id] = Number($(`score-${q.id}`).value);
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await guard(async () => {
      await call("gradeEssay", { id: attempt.id, scores });
      $("review").hidden = true;
      message("تم اعتماد النتيجة.");
      await list();
    });
  } finally {
    button.disabled = false;
  }
};
let cursor = "";
async function students(reset = false) {
  if (reset) {
    cursor = "";
    $("students").replaceChildren();
  }
  const result = await call("adminStudents", { after: cursor });
  for (const p of result.rows) {
    const row = n("tr");
    [
      p.fullName,
      p.username,
      p.phone,
      p.school,
      p.bestScore === null ? "—" : `${p.bestScore}/20`,
      p.lastLoginEventAt
        ? new Date(p.lastLoginEventAt).toLocaleString("ar-EG")
        : "—",
    ].forEach((v) => row.append(n("td", v)));
    $("students").append(row);
  }
  cursor = result.next;
  $("moreStudents").hidden = !cursor;
}
$("moreStudents").onclick = () => guard(() => students());
$("refresh").onclick = () =>
  guard(async () => {
    await list();
    await students(true);
  });
if (location.search.includes("emulator=1"))
  $("studentLink").href = "index.html?emulator=1";
if (!configured) message("يلزم إكمال إعداد Firebase أولًا.");
else
  watch((u) =>
    guard(async () => {
      if (!u) return;
      const claims = (await auth.currentUser.getIdTokenResult()).claims;
      if (claims.admin !== true) {
        message("هذا الحساب لا يملك صلاحية الإدارة.");
        return;
      }
      $("access").hidden = true;
      $("pending").hidden = false;
      $("studentsPanel").hidden = false;
      await list();
      await students(true);
    }),
  );
