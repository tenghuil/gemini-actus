// In-memory lock for concurrency safety

let lockPromise: Promise<any> | null = null;

export async function locked<T>(fn: () => Promise<T>): Promise<T> {
  while (lockPromise) {
    try {
      await lockPromise;
    } catch {
      // Ignore errors from earlier tasks
    }
  }
  const p = fn().finally(() => {
    if (lockPromise === p) {
      lockPromise = null;
    }
  });
  lockPromise = p;
  return p;
}
