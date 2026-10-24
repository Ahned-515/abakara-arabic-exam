import { readFileSync } from "node:fs";
import { initializeApp } from "../functions/node_modules/firebase-admin/lib/app/index.js";
import { getFirestore } from "../functions/node_modules/firebase-admin/lib/firestore/index.js";
import { validateExam, EXAM_ID } from "../functions/domain.js";
const [path, flag] = process.argv.slice(2);
if (!path)
  throw new Error(
    "Usage: node scripts/seed-exam.mjs reviewed-exam.json [--publish]",
  );
const exam = validateExam(JSON.parse(readFileSync(path, "utf8")));
if (
  !exam.version ||
  typeof exam.version !== "string" ||
  !exam.reviewedBy ||
  !exam.reviewedAt
)
  throw new Error("Set version, reviewedBy and reviewedAt.");
if (
  exam.questions.some((q) =>
    /TODO|PLACEHOLDER|يُستكمل|قيد الإعداد/i.test(q.text),
  )
)
  throw new Error("Unfinished question.");
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!["abakara-baccalaureate-b0758", "demo-abakara"].includes(project))
  throw new Error("Set GOOGLE_CLOUD_PROJECT explicitly to the exam project.");
if (flag && flag !== "--publish") throw new Error("Unknown option.");
initializeApp({ projectId: project });
await getFirestore()
  .doc(`exams/${EXAM_ID}`)
  .set({ ...exam, published: flag === "--publish" });
console.log(
  flag === "--publish"
    ? "Reviewed exam published."
    : "Reviewed exam saved CLOSED.",
);
