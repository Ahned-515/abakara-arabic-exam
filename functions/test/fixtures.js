export const student = {
  fullName: "أحمد محمد علي حسن",
  phone: "٠١٠١٢٣٤٥٦٧٨",
  school: "مدرسة الاختبار",
  username: "Student_1",
};
export function exam() {
  const topics = ["النحو", "البلاغة", "القراءة", "النصوص", "القصة"];
  return {
    title: "اختبار برمجي اصطناعي — ليس محتوى للطلاب",
    version: "test-v1",
    durationSeconds: 1800,
    maxAttempts: 3,
    totalMarks: 20,
    reviewed: true,
    published: true,
    questions: Array.from({ length: 20 }, (_, i) => ({
      id: `q${i + 1}`,
      topic: topics[i % 5],
      marks: 1,
      text: `سؤال اصطناعي ${i + 1}`,
      type: i === 19 ? "essay" : "mcq",
      ...(i === 19
        ? { rubric: "درجة كاملة للاختبار البرمجي" }
        : { options: ["صحيح", "خطأ"], correctIndex: 0 }),
    })),
  };
}
