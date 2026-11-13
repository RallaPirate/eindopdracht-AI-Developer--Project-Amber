const dispatchGuards = new WeakMap<AbortSignal, () => void>();

export function guardedSupabaseSignal(requireCurrent: () => void): AbortSignal {
  const { signal } = new AbortController();
  dispatchGuards.set(signal, requireCurrent);
  return signal;
}

export const fetchWithSupabaseDispatchGuard: typeof fetch = (input, init) => {
  // PostgREST forwards the request signal to the custom fetch after the SDK's
  // asynchronous token lookup. The signal carries the guard locally only.
  if (init?.signal) dispatchGuards.get(init.signal)?.();
  return fetch(input, init);
};
