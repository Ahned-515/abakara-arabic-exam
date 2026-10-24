import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  browserSessionPersistence,
  setPersistence,
} from "firebase/auth";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "firebase/functions";
import { firebaseConfig, functionsRegion } from "./config.js";
const local =
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).get("emulator") === "1";
const config = local
  ? {
      apiKey: "demo-key",
      projectId: "demo-abakara",
      authDomain: "demo-abakara.firebaseapp.com",
    }
  : firebaseConfig;
export const configured = Boolean(config.apiKey && config.projectId);
export let auth, functions;
if (configured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  functions = getFunctions(app, functionsRegion);
  if (local) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
  await setPersistence(auth, browserSessionPersistence);
}
export const call = async (name, data = {}) =>
  (await httpsCallable(functions, name)(data)).data;
export const watch = (fn) => onAuthStateChanged(auth, fn);
export const logout = () => signOut(auth);
const email = (u) => `${u.trim().toLowerCase()}@students.abakara.invalid`;
export async function login(u, p) {
  return signInWithEmailAndPassword(auth, email(u), p);
}
export async function register(u, p) {
  return createUserWithEmailAndPassword(auth, email(u), p);
}
export function errorText(e) {
  const messages = {
    "auth/invalid-credential": "اسم المستخدم أو كلمة المرور غير صحيحة.",
    "auth/email-already-in-use":
      "اسم المستخدم مسجل. سجّل الدخول لاستكمال حسابك.",
    "auth/weak-password": "استخدم كلمة مرور من 8 أحرف على الأقل.",
    "auth/too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم حاول.",
    "auth/network-request-failed": "تعذر الاتصال. تحقق من الإنترنت.",
    "functions/unavailable": "الخدمة غير متاحة. تحقق من الاتصال وحاول مجددًا.",
    "functions/unauthenticated": "انتهت الجلسة. سجّل الدخول مجددًا.",
  };
  return (
    messages[e.code] ??
    (e.code === "functions/failed-precondition"
      ? e.message
      : "تعذر إتمام العملية. حاول مجددًا، وإذا استمرت المشكلة تواصل مع المشرف.")
  );
}
