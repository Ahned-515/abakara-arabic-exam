import { test, expect } from "@playwright/test";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/app/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/auth/index.js";
test("unconfigured production view is honest and responsive", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#setup")).toBeVisible();
  await expect(page.locator("#authPanel")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/setup-${info.project.name}.png`,
    fullPage: true,
  });
});
test("student registration, save/resume, essay review and final result", async ({
  page,
}, info) => {
  test.skip(
    !process.env.FIRESTORE_EMULATOR_HOST,
    "Requires npm run test:emulator:all",
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = `ui_${Date.now()}_${info.project.name}`;
  await page.goto("/?emulator=1");
  await page.locator("#registerTab").click();
  await page.locator("#username").fill(name);
  await page.locator("#password").fill("Test-pass-123");
  await page.locator("#authSubmit").click();
  await expect(page.locator("#profilePanel")).toBeVisible();
  await page.locator("#fullName").fill("أحمد محمد علي حسن");
  await page.locator("#phone").fill("01012345678");
  await page.locator("#school").fill("مدرسة الاختبار");
  await page.locator("#profileForm button").click();
  await expect(page.locator("#dashboard")).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.locator("#start").click();
  await expect(page.locator("#examPanel")).toBeVisible();
  await expect(page.locator(".question")).toHaveCount(20);
  await page.locator('input[name="q1"][value="0"]').check();
  await page.locator("#answer-q20").fill("إجابة مقالية");
  await page.locator("#save").click();
  await expect(page.locator("#saveState")).toContainText("آخر حفظ ناجح");
  await page.reload();
  await page.locator("#start").click();
  await expect(page.locator('input[name="q1"][value="0"]')).toBeChecked();
  await expect(page.locator("#answer-q20")).toHaveValue("إجابة مقالية");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/exam-${info.project.name}.png`,
    fullPage: true,
  });
  await page.locator("#submit").click();
  await expect(page.locator("#resultPanel")).toBeVisible();
  await expect(page.locator("#result")).toContainText("بانتظار تصحيح المقالي");
  await page.locator("#back").click();
  const app = initializeApp({ projectId: "demo-abakara" }, name);
  const admin = getAuth(app);
  const u = await admin.getUserByEmail(`${name}@students.abakara.invalid`);
  await admin.setCustomUserClaims(u.uid, { admin: true });
  await page.locator("#logout").click();
  await page.locator("#username").fill(name);
  await page.locator("#password").fill("Test-pass-123");
  await page.locator("#authSubmit").click();
  await expect(page.locator("#adminLink")).toBeVisible();
  await page.locator("#adminLink").click();
  await expect(page.locator("#pending")).toBeVisible();
  await page.locator("#list button").last().click();
  await page.locator("#score-q20").fill("0.5");
  await page.locator("#reviewForm button").click();
  await expect(page.locator("#message")).toContainText("تم اعتماد");
  await page.locator("#studentLink").click();
  await expect(page.locator("#attemptList")).toContainText("1.5/20");
  expect(errors).toEqual([]);
});
