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

// Same idea as withTimeout, but bound to a fixed point in time shared across
// an entire job (e.g. JOB_DEADLINE_MS in the process route) rather than a
// fresh duration per call — lets many independent steps all race against
// the SAME overall budget instead of each getting their own full timeout
// stacked on top of the others. Moved here (was process/route.ts-local)
// so normalize.ts's per-chunk AI calls can share it too — see its use in
// runChunk, which needs to stop waiting on a chunk that would otherwise
// finish only after the job's own deadline has already passed, without
// throwing away whatever OTHER chunks already succeeded.
export class JobTimeoutError extends Error {
  constructor(label: string) { super(`${label} took too long — processing was stopped after its safe time budget to avoid hanging forever.`); }
}

export function raceWithDeadline<T>(promise: Promise<T>, deadlineAt: number, label: string): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new JobTimeoutError(label));
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(label)), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
