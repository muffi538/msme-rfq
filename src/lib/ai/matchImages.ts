// Best-effort image → line-item matching by text overlap between an image's
// OCR'd text and each item's name/brand/spec. Not computer vision (no object
// detection) — an image only matches if words from its OCR'd text actually
// appear in an item's fields, e.g. a photo of a labelled product box next to
// a spec sheet mentioning the same model name. Anything below the threshold
// is left unassigned rather than guessed.
const STOPWORDS = new Set(["the", "and", "for", "with", "pcs", "unit", "units", "qty", "item", "items"]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

export type MatchTarget = { id: string; name: string; brand: string | null; spec: string | null };

export function matchImageToItem(
  ocrText: string,
  items: MatchTarget[]
): { itemId: string; confidence: number } | null {
  const imageTokens = tokenize(ocrText);
  if (imageTokens.size === 0) return null;

  let best: { itemId: string; confidence: number } | null = null;

  for (const item of items) {
    const itemTokens = tokenize([item.name, item.brand ?? "", item.spec ?? ""].join(" "));
    if (itemTokens.size === 0) continue;

    let overlap = 0;
    for (const t of itemTokens) if (imageTokens.has(t)) overlap++;
    // Require at least 2 shared distinctive words — a single shared word
    // (e.g. just the brand) is too weak a signal on its own and produces
    // false positives across multiple items from the same brand.
    if (overlap < 2) continue;

    const confidence = overlap / Math.min(itemTokens.size, imageTokens.size);
    if (confidence >= 0.3 && (!best || confidence > best.confidence)) {
      best = { itemId: item.id, confidence };
    }
  }

  return best;
}
