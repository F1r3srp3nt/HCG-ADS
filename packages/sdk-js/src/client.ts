import { CONTRACT_VERSION, type AdContext, type Consent, type DeliveryRequest, type DeliveryResponse, type DeviceClass, type EventType, type PlacementInfo, type RenderableAd } from "./types";
import { FrequencyStore } from "./frequency";
import { deviceClass } from "./layout";
import { renderAd } from "./render";

declare const __SDK_VERSION__: string;
export const VERSION: string = typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "0.1.0-dev";

export interface RenderEvent { element: Element; placement: string; ad: RenderableAd }
export interface EmptyEvent { element: Element; placement: string; reason: string }
export interface ErrorEvent { element: Element; placement: string; error: unknown }

export interface InitOptions {
  /** Base URL of HCG ADS (e.g. https://ads.hakmicapitalgroup.com). Derived from the script's src when omitted. */
  endpoint?: string;
  consent?: Consent | (() => Consent);
  /** Device class; detected from the viewport width when omitted. */
  device?: DeviceClass;
  /** Page-level context merged into every placement's context. */
  context?: AdContext;
  /** Request timeout in milliseconds (default 3000). */
  timeoutMs?: number;
  /** Logs decisions to the console. */
  debug?: boolean;
  /** Scan for [data-hcg-ads-placement] elements on init (default true). */
  autoScan?: boolean;
  /** Also render placements added to the page later (default false). */
  observe?: boolean;
  /** Shadow root mode for rendered ads (default "closed"). */
  shadowMode?: "open" | "closed";
  onRender?: (e: RenderEvent) => void;
  onEmpty?: (e: EmptyEvent) => void;
  onError?: (e: ErrorEvent) => void;
  /** Injection points for tests and non-browser hosts. */
  fetch?: typeof fetch;
  sendBeacon?: (url: string) => boolean;
}

export interface PlacementOptions { placement: string; context?: AdContext }

interface Slot {
  options: PlacementOptions;
  root: ShadowRoot;
  originalDisplay: string;
  deliveryId: string | null;
  cleanup: Array<() => void>;
  abort: AbortController | null;
  generation: number;
}

/** Default consent: aggregate measurement only; nothing stored on the device. */
export const DEFAULT_CONSENT: Consent = { storage: false, measurement: true };

/**
 * HCG ADS client. Every public method is safe to call: failures are reported
 * through onError/onEmpty and never thrown into the host page. Responses are
 * not cached (every render is a new delivery); only the configuration is kept.
 */
export class HCGAdsClient {
  readonly version = VERSION;
  private opts: InitOptions = {};
  private endpoint: string | null = null;
  private consentValue: Consent | (() => Consent) = DEFAULT_CONSENT;
  private slots = new WeakMap<Element, Slot>();
  private roots = new WeakMap<Element, ShadowRoot>();
  private active = new Set<Element>();
  private sent = new Set<string>();
  private observer: MutationObserver | null = null;
  readonly frequency = new FrequencyStore(() => this.consent().storage);
  initialised = false;

  init(options: InitOptions = {}): this {
    this.opts = { ...this.opts, ...options };
    if (options.consent) this.consentValue = options.consent;
    if (options.endpoint) this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.initialised = true;
    if (this.opts.autoScan !== false && typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => this.scan(), { once: true });
      else this.scan();
    }
    if (this.opts.observe && typeof MutationObserver !== "undefined" && !this.observer && typeof document !== "undefined") {
      this.observer = new MutationObserver(() => this.scan());
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    return this;
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  consent(): Consent {
    try {
      const c = typeof this.consentValue === "function" ? this.consentValue() : this.consentValue;
      return { storage: !!c?.storage, measurement: !!c?.measurement };
    } catch {
      return { storage: false, measurement: false };
    }
  }

  setConsent(c: Consent | (() => Consent)): void {
    const before = this.consent().storage;
    this.consentValue = c;
    if (before && !this.consent().storage) this.frequency.clearPersistent();
  }

  private log(...args: unknown[]) {
    if (this.opts.debug && typeof console !== "undefined") console.info("[HCG ADS]", ...args);
  }

  /** Renders every [data-hcg-ads-placement] element that is not rendered yet. */
  scan(root: ParentNode = document): void {
    try {
      root.querySelectorAll<HTMLElement>("[data-hcg-ads-placement]").forEach((e) => {
        if (this.slots.has(e)) return;
        const placement = e.dataset.hcgAdsPlacement;
        if (!placement) return;
        const keywords = e.dataset.hcgAdsKeywords?.split(",").map((s) => s.trim()).filter(Boolean);
        void this.render(e, { placement, context: { category: e.dataset.hcgAdsCategory || undefined, keywords } });
      });
    } catch (error) {
      this.log("scan failed", error);
    }
  }

  /** Registers a placement in an element and requests an ad for it. */
  async render(target: Element | string, options: PlacementOptions): Promise<RenderableAd | null> {
    let element: Element | null = null;
    try {
      element = typeof target === "string" ? document.querySelector(target) : target;
      if (!element || !options?.placement) return null;
      const existing = this.slots.get(element);
      let root = this.roots.get(element);
      if (!root) {
        root = element.attachShadow({ mode: this.opts.shadowMode ?? "closed" });
        this.roots.set(element, root);
      }
      const slot: Slot = existing
        ? { ...existing, options }
        : { options, root, originalDisplay: (element as HTMLElement).style?.display ?? "", deliveryId: null, cleanup: [], abort: null, generation: 0 };
      this.slots.set(element, slot);
      this.active.add(element);
      return await this.load(element, slot);
    } catch (error) {
      if (element) this.fail(element, options?.placement ?? "", error, null);
      return null;
    }
  }

  /** Requests a new ad for an already registered element. */
  async refresh(target: Element | string): Promise<RenderableAd | null> {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    const slot = element ? this.slots.get(element) : undefined;
    if (!element || !slot) return null;
    return this.load(element, slot);
  }

  /** Removes the ad, observers and timers from an element. */
  destroy(target: Element | string): void {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) return;
    const slot = this.slots.get(element);
    if (!slot) return;
    this.teardown(slot);
    while (slot.root.firstChild) slot.root.removeChild(slot.root.firstChild);
    this.slots.delete(element);
    this.active.delete(element);
    (element as HTMLElement).style.display = slot.originalDisplay;
    element.removeAttribute("aria-hidden");
    element.removeAttribute("data-hcg-ads-state");
  }

  destroyAll(): void {
    for (const e of [...this.active]) this.destroy(e);
    this.observer?.disconnect();
    this.observer = null;
  }

  private teardown(slot: Slot) {
    slot.abort?.abort();
    slot.cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });
    slot.cleanup = [];
  }

  private resolveEndpoint(): string {
    if (this.endpoint) return this.endpoint;
    throw new Error("HCG ADS endpoint is not configured. Pass { endpoint } to HCGAds.init().");
  }

  private device(): DeviceClass {
    if (this.opts.device) return this.opts.device;
    try { return deviceClass(window.innerWidth || 1024); } catch { return "any"; }
  }

  private async load(element: Element, slot: Slot): Promise<RenderableAd | null> {
    this.teardown(slot);
    const generation = ++slot.generation;
    const placementKey = slot.options.placement;
    element.setAttribute("data-hcg-ads-state", "loading");
    let response: DeliveryResponse | null = null;
    try {
      const consent = this.consent();
      const context: AdContext = { ...(this.opts.context ?? {}), ...(slot.options.context ?? {}) };
      if (!context.category) delete context.category;
      if (!context.keywords?.length) delete context.keywords;
      const body: DeliveryRequest = {
        placement: placementKey,
        platform: "web",
        device: this.device(),
        context,
        consent,
        exclude: this.frequency.capped(),
        sdk: { name: "hcg-ads-js", version: VERSION },
      };
      const controller = new AbortController();
      slot.abort = controller;
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 3000);
      try {
        const f = this.opts.fetch ?? fetch;
        const res = await f(`${this.resolveEndpoint()}/delivery/v1/ad`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
          credentials: "omit",
          mode: "cors",
          referrerPolicy: "strict-origin",
        });
        response = (await res.json()) as DeliveryResponse;
      } finally {
        clearTimeout(timer);
        slot.abort = null;
      }
    } catch (error) {
      if (generation !== slot.generation) return null;
      this.fail(element, placementKey, error, null);
      return null;
    }
    if (generation !== slot.generation) return null;

    if (!response || response.contractVersion !== CONTRACT_VERSION) {
      this.log(`unsupported contract version ${response?.contractVersion}; treating as empty`);
      this.empty(element, placementKey, "unsupported_contract_version", response?.placement ?? null);
      return null;
    }
    const ad = response.ad;
    if (!ad) {
      this.empty(element, placementKey, response.reason ?? "no_ad", response.placement);
      return null;
    }
    return this.show(element, slot, ad, response.placement);
  }

  private show(element: Element, slot: Slot, ad: RenderableAd, placement: PlacementInfo | null): RenderableAd {
    const consent = this.consent();
    const clickUrl = consent.measurement ? ad.clickUrl : `${ad.clickUrl}${ad.clickUrl.includes("?") ? "&" : "?"}m=0`;
    const r = renderAd(slot.root, ad, placement, { clickUrl });
    slot.deliveryId = ad.deliveryId;
    (element as HTMLElement).style.display = slot.originalDisplay;
    element.removeAttribute("aria-hidden");
    element.setAttribute("data-hcg-ads-state", "rendered");

    if (r.media) {
      const onError = () => {
        this.beacon(ad, "error");
        this.fail(element, slot.options.placement, new Error("Advertising media failed to load"), placement);
      };
      r.media.addEventListener("error", onError);
      slot.cleanup.push(() => r.media!.removeEventListener("error", onError));
    }
    this.frequency.record(ad.campaignId, ad.frequency);
    this.beacon(ad, "impression");
    this.watchViewability(element, slot, ad);
    if (r.video) this.watchVideo(slot, ad, r.video);

    this.log("rendered", slot.options.placement, ad.campaignId, ad.headline);
    this.dispatch(element, "hcg-ads:render", { placement: slot.options.placement, ad });
    try { this.opts.onRender?.({ element, placement: slot.options.placement, ad }); } catch { /* host callback */ }
    return ad;
  }

  /** Sends one measurement event per delivery and type, only with measurement consent. */
  beacon(ad: RenderableAd, type: EventType): boolean {
    if (ad.preview || !this.consent().measurement) return false;
    const key = `${ad.deliveryId}:${type}`;
    if (this.sent.has(key)) return false;
    this.sent.add(key);
    const url = type === "impression" ? ad.beacons.impression : type === "viewable" ? ad.beacons.viewable : ad.beacons.video.replace(/\/video$/, `/${type}`);
    try {
      const send = this.opts.sendBeacon ?? (typeof navigator !== "undefined" && navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null);
      if (send && send(url)) return true;
      const f = this.opts.fetch ?? fetch;
      void f(url, { method: "POST", keepalive: true, mode: "cors", credentials: "omit" }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  /** Viewable: at least half of the ad visible for one continuous second. */
  private watchViewability(element: Element, slot: Slot, ad: RenderableAd) {
    if (typeof IntersectionObserver === "undefined" || ad.preview || !this.consent().measurement) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!timer) timer = setTimeout(() => { this.beacon(ad, "viewable"); io.disconnect(); }, 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    }, { threshold: [0, 0.5, 1] });
    io.observe(element);
    slot.cleanup.push(() => { io.disconnect(); if (timer) clearTimeout(timer); });
  }

  private watchVideo(slot: Slot, ad: RenderableAd, video: HTMLVideoElement) {
    const marks: Array<[number, EventType]> = [[0.25, "video_25"], [0.5, "video_50"], [0.75, "video_75"]];
    const onPlay = () => this.beacon(ad, "video_start");
    const onTime = () => {
      if (!video.duration || !isFinite(video.duration)) return;
      const p = video.currentTime / video.duration;
      for (const [at, type] of marks) if (p >= at) this.beacon(ad, type);
    };
    const onEnd = () => this.beacon(ad, "video_complete");
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnd);
    slot.cleanup.push(() => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnd);
    });
  }

  private applyFallback(element: Element, placement: PlacementInfo | null) {
    const slot = this.slots.get(element);
    if (slot) while (slot.root.firstChild) slot.root.removeChild(slot.root.firstChild);
    const fallback = placement?.fallback ?? "collapse";
    const h = element as HTMLElement;
    if (fallback === "keep-space" && placement?.height) {
      h.style.display = slot?.originalDisplay ?? "";
      h.style.minHeight = `${placement.height}px`;
      element.setAttribute("aria-hidden", "true");
    } else {
      // "collapse", and "house-ad" until house ads exist: the host layout closes the gap.
      h.style.display = "none";
      element.setAttribute("aria-hidden", "true");
    }
  }

  private empty(element: Element, placement: string, reason: string, info: PlacementInfo | null) {
    this.applyFallback(element, info);
    element.setAttribute("data-hcg-ads-state", "empty");
    this.log("empty", placement, reason);
    this.dispatch(element, "hcg-ads:empty", { placement, reason });
    try { this.opts.onEmpty?.({ element, placement, reason }); } catch { /* host callback */ }
  }

  private fail(element: Element, placement: string, error: unknown, info: PlacementInfo | null) {
    try {
      this.applyFallback(element, info);
      element.setAttribute("data-hcg-ads-state", "error");
      this.log("error", placement, error);
      this.dispatch(element, "hcg-ads:error", { placement, error: String((error as Error)?.message ?? error) });
      this.opts.onError?.({ element, placement, error });
    } catch { /* never throw into the host */ }
  }

  private dispatch(element: Element, name: string, detail: unknown) {
    try { element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); } catch { /* ignore */ }
  }
}
