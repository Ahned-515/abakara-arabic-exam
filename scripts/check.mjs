import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dirs = ["js", "functions", "scripts"];
for (const dir of dirs)
  for (const f of readdirSync(dir))
    if (/\.(m?js)$/.test(f))
      execFileSync(process.execPath, ["--check", `${dir}/${f}`], {
        stdio: "inherit",
      });
for (const f of [
  "firebase.json",
  "firestore.indexes.json",
  "package.json",
  "functions/package.json",
])
  JSON.parse(readFileSync(f, "utf8"));
for (const file of ["index.html", "admin.html"]) {
  const text = readFileSync(file, "utf8");
  const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate id: ${file}`);
  for (const m of text.matchAll(/(?:src|href)="((?:dist|css)\/[^"]+)"/g))
    readFileSync(m[1]);
}
console.log("Syntax, JSON, unique IDs and built asset checks passed.");
