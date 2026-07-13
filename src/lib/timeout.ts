// Generic hard-deadline wrapper for a single promise. Used where a call
// needs its OWN bound regardless of any larger deadline a caller might also
// be tracking — e.g. a single third-party parser call must not be able to
// silently consume an entire job's shared time budget before anything
// notices something is wrong. Doesn't cancel the underlying work (Node has
// no way to preempt an in-flight promise), it just stops waiting on it and
// lets the caller treat the operation as failed.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} took longer than ${ms}ms and was aborted.`);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
