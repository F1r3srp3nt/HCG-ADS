import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, hasFfmpeg, makeMedia } from "./helpers.ts";
import { inspect, detectType } from "../src/media/inspect.ts";
import { checkCompatibility } from "../src/placements/compat.ts";
import { FfmpegProcessor } from "../src/media/processor.ts";

const ff = hasFfmpeg();
const dir = mkdtempSync(join(tmpdir(), "hcg-ads-media-"));
const files: Record<string, Buffer> = {};

beforeAll(() => {
  if (!ff) return;
  const src = (w: number, h: number) => ["-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=10`];
  files.png = makeMedia(dir, "a.png", [...src(300, 250), "-frames:v", "1"]);
  files.jpg = makeMedia(dir, "a.jpg", [...src(728, 90), "-frames:v", "1"]);
  files.webp = makeMedia(dir, "a.webp", [...src(970, 250), "-frames:v", "1"]);
  files.gif = makeMedia(dir, "a.gif", [...src(300, 250), "-frames:v", "5"]);
  files.big = makeMedia(dir, "big.png", [...src(600, 500), "-frames:v", "1"]);
  files.wrong = makeMedia(dir, "wrong.png", [...src(400, 400), "-frames:v", "1"]);
  files.mp4 = makeMedia(dir, "a.mp4", [...src(970, 250), "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  files.webm = makeMedia(dir, "a.webm", [...src(300, 250), "-t", "2", "-c:v", "libvpx-vp9", "-b:v", "200k"]);
  files.long = makeMedia(dir, "long.mp4", [...src(300, 250), "-t", "75", "-r", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
}, 120_000);

describe.skipIf(!ff)("media inspection (content-based, pure TypeScript)", () => {
  it("detects types and dimensions from bytes", () => {
    expect(inspect(files.png).metadata).toMatchObject({ mime: "image/png", width: 300, height: 250, aspectRatio: "6:5", animated: false });
    expect(inspect(files.jpg).metadata).toMatchObject({ mime: "image/jpeg", width: 728, height: 90 });
    expect(inspect(files.webp).metadata).toMatchObject({ mime: "image/webp", width: 970, height: 250 });
    expect(inspect(files.gif).metadata).toMatchObject({ mime: "image/gif", kind: "animated-image", animated: true, frameCount: 5 });
    expect(inspect(files.mp4).metadata).toMatchObject({ mime: "video/mp4", kind: "video", width: 970, height: 250, durationSeconds: 3 });
    expect(detectType(files.webm)).toEqual({ mime: "video/webm", kind: "video" });
  });

  it("refuses scripts, SVG and HTML whatever their name", () => {
    for (const s of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "<html><script>x</script></html>", "#!/bin/sh\nrm -rf /\n"]) {
      expect(inspect(Buffer.from(s)).problems[0]).toMatch(/Unsupported file type/);
    }
  });

  it("ffprobe adds WebM metadata", async () => {
    const m = await new FfmpegProcessor().probe(files.webm, inspect(files.webm).metadata);
    expect(m).toMatchObject({ width: 300, height: 250, videoCodec: "vp9" });
    expect(m.durationSeconds).toBeGreaterThan(1.5);
  });
});

describe("placement compatibility (never stretch or distort)", () => {
  const p = { formats: ["image", "animated-image", "video"] as any, width: 300, height: 250, responsive: "fixed" as const, maxFileBytes: 1_000_000, maxVideoSeconds: 30, allowAnimation: true };
  it("accepts exact and larger same-ratio media", () => {
    expect(checkCompatibility(p, { kind: "image", width: 300, height: 250, bytes: 1000, durationSeconds: null, animated: false })).toEqual([]);
    expect(checkCompatibility(p, { kind: "image", width: 600, height: 500, bytes: 1000, durationSeconds: null, animated: false })).toEqual([]);
  });
  it("refuses other ratios, smaller media, oversize, long video and animation where disallowed", () => {
    expect(checkCompatibility(p, { kind: "image", width: 400, height: 400, bytes: 1000, durationSeconds: null, animated: false })[0]).toMatch(/Aspect ratio/);
    expect(checkCompatibility(p, { kind: "image", width: 150, height: 125, bytes: 1000, durationSeconds: null, animated: false })[0]).toMatch(/upscaled/);
    expect(checkCompatibility(p, { kind: "image", width: 300, height: 250, bytes: 2_000_000, durationSeconds: null, animated: false })[0]).toMatch(/allows at most/);
    expect(checkCompatibility(p, { kind: "video", width: 300, height: 250, bytes: 1000, durationSeconds: 45, animated: false })[0]).toMatch(/30 s/);
    expect(checkCompatibility({ ...p, allowAnimation: false }, { kind: "animated-image", width: 300, height: 250, bytes: 1000, durationSeconds: null, animated: true })).toContain("This placement does not allow animation.");
  });
});

describe.skipIf(!ff)("external campaign with uploaded media", () => {
  it("validates, moderates, publishes only approved media and serves it", async () => {
    const h = await harness({ processor: new FfmpegProcessor() });
    const { sidebar } = await h.connectNews();
    const adv = (await h.api("POST", "/admin/v1/advertisers", { name: "Acme AS", kind: "external", contactEmail: "ads@acme.example", website: "https://acme.example" })).body;
    expect(adv.status).toBe("pending");

    const upload = async (name: string, data: Buffer) => {
      const fd = new FormData();
      fd.set("file", new File([new Uint8Array(data)], name));
      fd.set("advertiserId", adv.id);
      return h.api("POST", "/admin/v1/media", fd);
    };
    const good = (await upload("banner.png", files.big)).body;
    expect(good).toMatchObject({ status: "ready", visibility: "private", publicUrl: null, thumbnailAvailable: true });
    expect(good.metadata).toMatchObject({ width: 600, height: 500 });
    expect(good.compatiblePlacementIds).toContain(sidebar.id);
    const wrong = (await upload("square.png", files.wrong)).body;
    expect(wrong.compatiblePlacementIds).not.toContain(sidebar.id);
    const long = (await upload("long.mp4", files.long)).body;
    expect(long.status).toBe("rejected");
    expect(long.problems.join(" ")).toMatch(/maximum is 60s/);
    expect((await upload("evil.png", Buffer.from("<svg onload=alert(1)>"))).status).toBe(415);
    const webm = (await upload("clip.webm", files.webm)).body;
    expect(webm.derivatives).toContain("compat-mp4");

    // Private media is only reachable with a signed preview URL.
    const priv = await h.app.request(good.previewUrl.replace("http://127.0.0.1:7800", ""));
    expect(priv.status).toBe(200);
    expect((await h.app.request(`/admin/v1/media/${good.id}/content?t=forged.token`)).status).toBe(403);

    const cmp = (await h.api("POST", "/admin/v1/campaigns", {
      name: "Acme launch", kind: "external", advertiserId: adv.id, placementIds: [sidebar.id],
      pricing: { model: "cpm", rateMinor: 5000, budgetMinor: 100000, currency: "NOK" },
      frequencyLimit: { count: 3, windowHours: 24 },
    })).body;
    expect(cmp.disclosureLabel).toBe("Sponsored");
    const bad = await h.api("POST", `/admin/v1/campaigns/${cmp.id}/creatives`, {
      type: "image", headline: "VIRUS DETECTED on your device", callToAction: "Clean now", destinationUrl: "http://bit.ly/x",
      variants: [{ mediaAssetId: wrong.id }],
    });
    expect(bad.status).toBe(201);
    const blocked = await h.api("POST", `/admin/v1/campaigns/${cmp.id}/submit`);
    expect(blocked.status).toBe(422);
    const problems: string[] = blocked.body.error.details;
    expect(problems.join("\n")).toMatch(/virus detected/i);
    expect(problems.join("\n")).toMatch(/https/);
    expect(problems.join("\n")).toMatch(/shorteners/);
    expect(problems.join("\n")).toMatch(/No variant .* fits Article sidebar/);
    expect(problems.join("\n")).toMatch(/advertiser Acme AS is not approved/);

    await h.api("PATCH", `/admin/v1/creatives/${bad.body.id}`, {
      headline: "Acme cloud, built in Norway", callToAction: "Learn more", destinationUrl: "https://acme.example/launch",
      variants: [{ device: "any", mediaAssetId: good.id }],
    });
    await h.api("POST", `/admin/v1/advertisers/${adv.id}/status`, { status: "approved" });
    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/submit`)).status).toBe(200);
    // External campaigns need a creative reviewer; analytics viewers cannot approve.
    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/approve`, {}, { "x-hcg-dev-roles": "analytics_viewer" })).status).toBe(403);
    // Four-eyes: the creator cannot approve their own external campaign.
    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/approve`)).body.error.code).toBe("four_eyes");
    // A distinct reviewer approves (simulate by changing the recorded creator).
    h.ctx.db.run("UPDATE campaigns SET created_by = 'someone-else' WHERE id = ?", cmp.id);
    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/approve`, { note: "OK" })).body.state).toBe("approved");
    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/activate`)).body.state).toBe("active");

    const asset = (await h.api("GET", `/admin/v1/media/${good.id}`)).body;
    expect(asset).toMatchObject({ status: "approved", visibility: "public" });
    const served = await h.app.request(asset.publicUrl.replace("http://127.0.0.1:7800", ""));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    // Unapproved media is never public.
    expect((await h.app.request("/delivery/v1/media/aaaaaaaaaaaaaaaaaaaaaaaa.png")).status).toBe(404);

    const ad = (await h.deliver(sidebar.publicKey)).ad;
    expect(ad).toMatchObject({ type: "image", disclosure: "Sponsored", sponsorName: "Acme AS", frequency: { count: 3, windowHours: 24 } });
    expect(ad.media).toMatchObject({ kind: "image", width: 600, height: 500 });

    // Media in use cannot be deleted; after archiving, deletion withdraws the public copy.
    expect((await h.api("DELETE", `/admin/v1/media/${good.id}`)).status).toBe(409);
    await h.api("POST", `/admin/v1/campaigns/${cmp.id}/pause`);
    await h.api("POST", `/admin/v1/campaigns/${cmp.id}/archive`);
    expect((await h.api("DELETE", `/admin/v1/media/${good.id}`)).status).toBe(204);
    expect((await h.app.request(asset.publicUrl.replace("http://127.0.0.1:7800", ""))).status).toBe(404);

    const revenue = (await h.api("GET", "/admin/v1/revenue")).body;
    expect(revenue.mode).toBe("test");
    expect(revenue.gateway.connected).toBe(false);
  }, 120_000);

  it("enforces advertiser storage quotas", async () => {
    const h = await harness();
    const adv = (await h.api("POST", "/admin/v1/advertisers", { name: "Tiny", kind: "external", storageQuotaBytes: 1000 })).body;
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(files.png)], "a.png"));
    fd.set("advertiserId", adv.id);
    const r = await h.api("POST", "/admin/v1/media", fd);
    expect(r.status).toBe(507);
  });
});
