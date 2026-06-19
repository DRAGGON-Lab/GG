import { useCallback, useEffect, useEffectEvent, useState } from "react";

type AsyncResourceState<T> = {
  data: T | null;
  error: string | null;
  resolvedKey: string | null;
};

export type AsyncResource<T> = {
  /// Last loaded (or mutated) value; kept while the next key loads
  /// (stale-while-revalidate).
  data: T | null;
  /// Error from loading the CURRENT key; errors from superseded keys vanish.
  error: string | null;
  /// True from the render that changes the key until that key resolves.
  loading: boolean;
  /// Replace the value locally (e.g. after a save) and mark the current key
  /// resolved.
  mutate: (value: T | null) => void;
};

/// Keyed async loading without synchronous effect state: `loading` is derived
/// by comparing the requested key with the last resolved one, so spinners
/// appear on the same render that changes the key. Refreshing is expressed by
/// folding a revision counter into the key. `key === null` loads nothing.
export function useAsyncResource<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
): AsyncResource<T> {
  const [state, setState] = useState<AsyncResourceState<T>>({
    data: null,
    error: null,
    resolvedKey: null,
  });
  const runLoad = useEffectEvent(load);

  useEffect(() => {
    if (key === null) {
      return;
    }

    let cancelled = false;

    runLoad(key).then(
      (data) => {
        if (!cancelled) {
          setState({ data, error: null, resolvedKey: key });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            data: previous.data,
            error: error instanceof Error ? error.message : String(error),
            resolvedKey: key,
          }));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key]);

  const mutate = useCallback(
    (value: T | null) =>
      setState({ data: value, error: null, resolvedKey: key }),
    [key],
  );

  return {
    data: state.data,
    error: state.resolvedKey === key ? state.error : null,
    loading: key !== null && state.resolvedKey !== key,
    mutate,
  };
}
