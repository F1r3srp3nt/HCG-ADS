import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { createApp } from "./http/app.ts";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const config = loadConfig(root);
const ctx = await createContext(config);
(ctx as unknown as { startSchedulers(): void }).startSchedulers();
const app = createApp(ctx);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const id = ctx.identity.status();
  console.log(`HCG ADS ${config.env} listening on http://${info.address}:${info.port}`);
  console.log(`  identity: ${id.label}`);
  console.log(`  storage:  ${ctx.media.storageDescription()}`);
  console.log(`  media:    ${ctx.media.processorInfo().name} processor`);
  console.log(`  HCG News: ${config.hcgNews ? "configured (public read)" : config.hcgNewsProblems.join(" ")}`);
  if (config.env !== "production") console.log(`  testbed:  ${config.publicBaseUrl}/testbed/`);
});

const stop = () => { ctx.shutdown(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
