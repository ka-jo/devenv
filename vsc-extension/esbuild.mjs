import esbuild from "esbuild";

/** Whether to emit a production (minified, no-sourcemap) bundle. */
const production = process.argv.includes("--production");
/** Whether to stay resident and rebuild on change. */
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  // `vscode` is provided by the extension host at runtime; never bundle it.
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
