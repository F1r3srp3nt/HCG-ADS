import { build } from "esbuild";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const common = { bundle: true, target: ["es2019", "safari13"], define: { __SDK_VERSION__: JSON.stringify(version) }, legalComments: "none" };

await build({ ...common, entryPoints: ["src/global.ts"], outfile: "dist/hcg-ads.js", format: "iife", sourcemap: true });
await build({ ...common, entryPoints: ["src/global.ts"], outfile: "dist/hcg-ads.min.js", format: "iife", minify: true, sourcemap: true });
await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.mjs", format: "esm", sourcemap: true });
console.log(`@hcg-ads/sdk ${version} built`);
