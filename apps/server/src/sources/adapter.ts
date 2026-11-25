import type { ContentItem, ContentPage, ContentSourceKind } from "@hcg-ads/contracts";

export interface BrowseOptions {
  cursor?: string | null;
  query?: string;
  category?: string;
  limit?: number;
}

/** Result of looking an item up at its source. */
export type ItemLookup =
  | { found: true; item: ContentItem }
  /** The source answered and the item is not (or no longer) published. */
  | { found: false; reason: "unpublished" | "not_found" }
  /** The source could not be asked; nothing should be concluded. */
  | { found: false; reason: "source_error"; message: string };

/**
 * A registered HCG content source (HCG News, HCG Store, the HCG website…).
 * Adapters read content; they never modify it.
 */
export interface ContentSourceAdapter {
  readonly kind: ContentSourceKind;
  readonly name: string;
  readonly description: string;
  readonly configured: boolean;
  readonly configurationProblems: string[];
  verify(): Promise<{ ok: boolean; message: string }>;
  browse(sourceId: string, options: BrowseOptions): Promise<ContentPage>;
  lookup(sourceId: string, externalId: string): Promise<ItemLookup>;
  categories(): Promise<Array<{ id: string; name: string; slug: string }>>;
}

/** A source HCG has not published a content contract for yet. Nothing is invented. */
export class UnconfiguredSourceAdapter implements ContentSourceAdapter {
  readonly configured = false;
  constructor(readonly kind: ContentSourceKind, readonly name: string, readonly description: string, readonly configurationProblems: string[]) {}
  async verify() { return { ok: false, message: this.configurationProblems.join(" ") }; }
  async browse(): Promise<ContentPage> { return { items: [], nextCursor: null }; }
  async lookup(): Promise<ItemLookup> { return { found: false, reason: "source_error", message: "Source not configured." }; }
  async categories() { return []; }
}
