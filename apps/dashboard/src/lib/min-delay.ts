// Enforces a minimum elapsed time on a promise — used so fast local requests still read
// as "loading" rather than flickering instantly, without adding latency beyond what the
// request already took.
export async function withMinDelay<T>(promise: Promise<T>, minMs = 1000): Promise<T> {
  const start = Date.now();
  try {
    return await promise;
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed < minMs) {
      await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
    }
  }
}
