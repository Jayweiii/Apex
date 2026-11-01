import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * Returns a function whose identity never changes but always calls the latest
 * `fn`. Use it for handlers passed into `memo` chart plots so a parent that
 * re-renders every playback frame does not force the plot to re-render too.
 *
 * Only call the returned function from events/effects, never during render.
 */
export function useStableCallback<Args extends unknown[], R>(
  fn: ((...args: Args) => R) | undefined,
): (...args: Args) => R | undefined {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current?.(...args), []);
}
