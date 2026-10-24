import { build } from "esbuild";
await build({
  entryPoints: ["js/app.js", "js/admin.js"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  minify: true,
  target: ["es2022"],
  legalComments: "eof",
});
