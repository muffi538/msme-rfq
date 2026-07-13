/**
 * Runs `worker` over every item in `items` with at most `limit` in flight
 * at once, preserving the original order in the returned array. Used to
 * parallelize independent, slow, per-item work (parsing several attachments,
 * processing several RFQs) without firing everything at once and blowing
 * through external API rate limits.
 *
 * `onItemDone` fires as each item finishes (not in order) — useful for
 * live progress reporting while the batch is still running.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onItemDone?: (result: R, item: T, index: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      const result = await worker(items[index], index);
      results[index] = result;
      onItemDone?.(result, items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}
