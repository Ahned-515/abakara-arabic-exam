import {
  auth,
  configured,
  call,
  watch,
  login,
  register,
  logout,
  errorText,
} from "./client.js";
const $ = (id) => document.getElementById(id);
const panels = [
  "authPanel",
  "profilePanel",
  "dashboard",
  "examPanel",
  "resultPanel",
];
let mode = "login",
  session = null,
  attempt = null,
  tick,
  saveTimer,
  queue = Promise.resolve(),
  dirty = false,
  change = 0,
  locked = false,
  conflict = false,
  expiryPending = false;
const statusNames = {
  active: "قيد الحل",
  pending_review: "بانتظار تصحيح المقالي",
  graded: "مكتملة التصحيح",
};
const time = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
function notice(text, type = "info") {
  $("message").textContent = text;
  $("message").className = `message ${type}`;
}
function show(id) {
  for (const p of panels) $(p).hidden = p !== id;
}
function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function busy(form, value) {
  for (const e of form.querySelectorAll("button,input")) e.disabled = value;
}
async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    notice(errorText(e), "error");
    return null;
  }
}
function authMode(next) {
  mode = next;
  $("authLegend").textContent =
    next === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد";
  $("authSubmit").textContent = next === "login" ? "دخول" : "إنشاء الحساب";
  $("password").autocomplete =
    next === "login" ? "current-password" : "new-password";
  $("loginTab").setAttribute("aria-pressed", String(next === "login"));
  $("registerTab").setAttribute("aria-pressed", String(next === "register"));
}
$("loginTab").onclick = () => authMode("login");
$("registerTab").onclick = () => authMode("register");
$("showPassword").onchange = () => {
  $("password").type = $("showPassword").checked ? "text" : "password";
};
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, true);
  await guard(async () => {
    const u = $("username").value.trim();
    if (!/^[A-Za-z0-9_]{3,30}$/.test(u))
      throw {
        code: "functions/failed-precondition",
        message: "اسم المستخدم غير صحيح.",
      };
    await (mode === "register" ? register : login)(u, $("password").value);
    $("password").value = "";
    notice("تم تسجيل الدخول.", "success");
  });
  busy(form, false);
};
$("profileForm").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, true);
  await guard(async () => {
    await call("completeProfile", {
      username: auth.currentUser.email.split("@")[0],
      fullName: $("fullName").value,
      phone: $("phone").value,
      school: $("school").value,
    });
    $("profileForm").reset();
    await dashboard();
    notice("تم حفظ بيانات الحساب.", "success");
  });
  busy(form, false);
};
$("logout").onclick = () =>
  guard(async () => {
    await logout();
    notice("تم تسجيل الخروج.");
  });
async function leaders() {
  const rows = await call("leaderboard");
  $("leaders").replaceChildren();
  rows.forEach((r, i) => {
    const tr = node("tr");
    [i + 1, r.fullName, `${r.score} / 20`, time(r.durationSeconds)].forEach(
      (x) => tr.append(node("td", x)),
    );
    $("leaders").append(tr);
  });
  if (!rows.length) {
    const tr = node("tr");
    const td = node("td", "لا توجد نتائج نهائية بعد.");
    td.colSpan = 4;
    tr.append(td);
    $("leaders").append(tr);
  }
  $("leaderboardPanel").hidden = false;
}
async function dashboard() {
  clearInterval(tick);
  clearTimeout(saveTimer);
  attempt = null;
  dirty = false;
  conflict = false;
  session = await call("home");
  if (!session.profile) {
    show("profilePanel");
    return;
  }
  show("dashboard");
  $("greeting").textContent = `أهلًا، ${session.profile.fullName}`;
  const claims = (await auth.currentUser.getIdTokenResult()).claims;
  $("adminLink").hidden = claims.admin !== true;
  if (new URLSearchParams(location.search).has("emulator"))
    $("adminLink").href = "admin.html?emulator=1";
  const active = session.attempts.find((a) => a.status === "active");
  $("attemptCount").textContent =
    claims.unlimitedAttempts === true
      ? "حساب مستثنى من حد المحاولات."
      : `المحاولات المستخدمة: ${session.state.count ?? 0} من 3`;
  $("examStatus").textContent = session.exam.published
    ? "الامتحان متاح. تأكد من اتصال الإنترنت قبل البدء."
    : "الامتحان مغلق حتى مراجعة الأسئلة واعتمادها.";
  $("start").textContent = active ? "استئناف المحاولة" : "بدء الامتحان";
  $("start").disabled =
    (!active && !session.exam.published) ||
    (!active &&
      claims.unlimitedAttempts !== true &&
      (session.state.count ?? 0) >= 3);
  $("attemptList").replaceChildren();
  for (const a of session.attempts) {
    const row = node("div", undefined, "attempt");
    row.append(
      node(
        "p",
        `${new Date(a.startedAt).toLocaleString("ar-EG")} — ${statusNames[a.status]}`,
      ),
    );
    if (a.status === "graded")
      row.append(
        node("p", `الدرجة: ${a.score}/20 · الزمن: ${time(a.durationSeconds)}`),
      );
    const b = node(
      "button",
      a.status === "active" ? "استئناف" : "عرض النتيجة",
      "secondary",
    );
    b.onclick = () => guard(() => openAttempt(a.id));
    row.append(b);
    $("attemptList").append(row);
  }
  if (!session.attempts.length)
    $("attemptList").append(node("p", "لم تبدأ أي محاولة بعد."));
  await leaders();
}
$("refresh").onclick = () => guard(dashboard);
$("back").onclick = () => guard(dashboard);
$("start").onclick = () =>
  guard(async () => {
    const active = session.attempts.some((a) => a.status === "active");
    if (
      !active &&
      !confirm("ستُحتسب محاولة ويبدأ وقت 30 دقيقة فورًا. هل أنت مستعد؟")
    )
      return;
    $("start").disabled = true;
    try {
      const r = await call("startAttempt");
      await openAttempt(r.id);
    } finally {
      $("start").disabled = false;
    }
  });
async function openAttempt(id) {
  clearInterval(tick);
  clearTimeout(saveTimer);
  attempt = await call("getAttempt", { id });
  dirty = false;
  conflict = false;
  locked = false;
  expiryPending = false;
  change = 0;
  if (attempt.status !== "active") {
    showResult();
    return;
  }
  show("examPanel");
  $("questions").replaceChildren();
  $("questionNav").replaceChildren();
  $("saveState").textContent =
    "الإجابات المحفوظة محمّلة. يُحفظ كل تعديل تلقائيًا.";
  setLocked(false);
  attempt.questions.forEach((q, i) => {
    const field = node("fieldset", undefined, "question");
    field.id = `question-${q.id}`;
    field.append(node("legend", `${i + 1}. ${q.text}`));
    field.append(node("small", `${q.topic} · ${q.marks} درجة`));
    if (q.type === "mcq")
      q.options.forEach((o, j) => {
        const label = node("label", undefined, "option"),
          input = node("input");
        input.type = "radio";
        input.name = q.id;
        input.value = j;
        input.checked = attempt.answers[q.id] === j;
        input.onchange = () => changed(q.id, j);
        label.append(input, node("span", o));
        field.append(label);
      });
    else {
      const label = node("label", "إجابتك المقالية");
      label.htmlFor = `answer-${q.id}`;
      const area = node("textarea");
      area.id = label.htmlFor;
      area.maxLength = 6000;
      area.value = attempt.answers[q.id] ?? "";
      area.oninput = () => changed(q.id, area.value);
      field.append(label, area);
    }
    $("questions").append(field);
    const nav = node("button", i + 1);
    nav.type = "button";
    nav.setAttribute("aria-label", `السؤال ${i + 1}`);
    nav.onclick = () => field.scrollIntoView({ block: "start" });
    $("questionNav").append(nav);
  });
  const remaining = Math.max(0, attempt.expiresAt - attempt.serverNow),
    started = performance.now();
  function update() {
    const left = Math.max(
      0,
      Math.ceil((remaining - (performance.now() - started)) / 1000),
    );
    $("timer").textContent = time(left);
    if (left === 0 && !expiryPending) {
      expiryPending = true;
      setLocked(true);
      save(true)
        .catch(() => {})
        .finally(() => {
          expiryPending = false;
        });
    }
  }
  update();
  tick = setInterval(update, 1000);
  notice("بدأت المحاولة. احرص على متابعة حالة الحفظ.");
  $("examHeading").scrollIntoView();
}
function changed(id, value) {
  if (locked) return;
  attempt.answers[id] = value;
  dirty = true;
  change++;
  $("saveState").textContent = "تعديلات لم تُحفظ بعد…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false).catch(() => {}), 900);
}
function setLocked(value) {
  locked = value;
  for (const x of $("questions").querySelectorAll("input,textarea"))
    x.disabled = value;
  $("save").disabled = value;
  $("submit").disabled = value;
}
function save(submit) {
  queue = queue
    .catch(() => {})
    .then(async () => {
      if (!attempt || attempt.status !== "active" || conflict) return;
      const version = change;
      const answers = structuredClone(attempt.answers);
      try {
        const r = await call(submit ? "submitAttempt" : "saveAnswers", {
          id: attempt.id,
          answers,
          revision: attempt.revision,
        });
        attempt.revision = r.revision;
        if (version === change) dirty = false;
        if (r.status !== "active") {
          clearInterval(tick);
          attempt = await call("getAttempt", { id: attempt.id });
          showResult();
          notice("تم تسليم المحاولة وحفظها.", "success");
          return;
        }
        $("saveState").textContent = dirty
          ? "توجد تعديلات جديدة جارٍ حفظها…"
          : `آخر حفظ ناجح: ${new Date(r.lastSavedAt).toLocaleTimeString("ar-EG")}`;
      } catch (e) {
        if (e.message?.includes("تبويب آخر")) {
          conflict = true;
          setLocked(true);
          const b = node("button", "تحميل آخر إجابات محفوظة");
          b.onclick = () => guard(() => openAttempt(attempt.id));
          $("saveState").replaceChildren(
            node("span", "تعارض مع تبويب آخر. حمّل آخر حفظ قبل المتابعة."),
            b,
          );
        } else
          $("saveState").textContent =
            "فشل الحفظ أو التسليم. لم يُؤكد وصول التعديلات. تحقق من الإنترنت ثم أعد المحاولة.";
        notice(errorText(e), "error");
        throw e;
      }
    });
  return queue;
}
$("save").onclick = () => save(false).catch(() => {});
$("submit").onclick = async () => {
  const missing = attempt.questions.filter(
    (q) => attempt.answers[q.id] === undefined || attempt.answers[q.id] === "",
  ).length;
  if (
    !confirm(
      `هل تريد التسليم النهائي؟ ${missing ? `يوجد ${missing} سؤال بلا إجابة.` : ""}`,
    )
  )
    return;
  clearTimeout(saveTimer);
  setLocked(true);
  try {
    await save(true);
  } catch {
    if (!conflict) setLocked(false);
  }
};
function showResult() {
  clearInterval(tick);
  clearTimeout(saveTimer);
  show("resultPanel");
  $("result").replaceChildren();
  $("result").append(
    node("p", statusNames[attempt.status]),
    node("p", `الزمن: ${time(attempt.durationSeconds)}`),
  );
  if (attempt.status === "graded")
    $("result").append(node("h3", `درجتك: ${attempt.score} / 20`));
  else
    $("result").append(
      node(
        "p",
        "الدرجة النهائية والترتيب يظهران بعد مراجعة الإجابات المقالية.",
      ),
    );
  for (const q of attempt.questions) {
    const box = node("div", undefined, "review");
    box.append(node("p", q.text));
    const a = attempt.answers[q.id];
    box.append(
      node(
        "p",
        a === undefined ? "لم تُجب" : q.type === "mcq" ? q.options[a] : a,
        "answerText",
      ),
    );
    if (attempt.breakdown?.[q.id] !== undefined)
      box.append(
        node(
          "small",
          attempt.breakdown[q.id] === null
            ? "بانتظار التصحيح"
            : `${attempt.breakdown[q.id]} / ${q.marks}`,
        ),
      );
    $("result").append(box);
  }
  dirty = false;
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("online", () => {
  if (attempt?.status === "active" && !conflict) save(false).catch(() => {});
});
window.addEventListener("offline", () => {
  notice(
    "انقطع الإنترنت. لا يُؤكد حفظ إجابات جديدة حتى عودة الاتصال.",
    "error",
  );
});
if (!configured) {
  $("setup").hidden = false;
} else
  watch((user) => {
    if (user) {
      guard(async () => {
        await dashboard();
        call("loginEvent").catch(() => {});
      });
    } else {
      clearInterval(tick);
      attempt = null;
      dirty = false;
      show("authPanel");
      $("leaderboardPanel").hidden = true;
    }
  });
