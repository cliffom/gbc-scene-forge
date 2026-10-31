import type { EditorLifetime } from '../editor/editor-lifetime.mts';

/** Scene routes retain the project prefix; preferences remain project scoped. */
export function projectPath(path: string): string {
  return /^\/projects\/[^/]+\//.exec(path)?.[0] ?? '/';
}

export function sceneFromPath(path: string, base: string): string | null {
  if (path === `${base}/`) {
    return null;
  }
  const match = path.startsWith(`${base}/`)
    ? /^scenes\/([^/]+)\/?$/.exec(path.slice(base.length + 1))
    : null;
  if (!match) {
    throw Error('Invalid scene URL. Choose a scene from the scene list.');
  }
  try {
    const id = decodeURIComponent(match[1]);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw Error('Invalid scene ID');
    }
    return id;
  } catch {
    throw Error('Invalid scene ID in URL. Choose a scene from the scene list.');
  }
}

/** Restore the active entry before prompting, so cancellation retains real history. */
export function createSceneNavigation(
  lifetime: EditorLifetime,
  base: string,
  navigate: (path: string) => Promise<boolean>,
) {
  function entryIndex(): number {
    const state: unknown = history.state;
    return typeof state === 'object' &&
      state !== null &&
      'forgeSceneIndex' in state &&
      typeof state.forgeSceneIndex === 'number'
      ? state.forgeSceneIndex
      : 0;
  }
  let index = entryIndex();
  history.replaceState({ ...history.state, forgeSceneIndex: index }, '');
  let traversing = false;
  let arrival: { index: number; resolve: () => void } | null = null;
  const travel = (delta: number) =>
    new Promise<void>((resolve) => {
      arrival = { index: entryIndex() + delta, resolve };
      history.go(delta);
    });
  lifetime.cleanup(() => arrival?.resolve());
  window.addEventListener(
    'popstate',
    () => {
      if (arrival) {
        if (entryIndex() !== arrival.index) {
          history.go(arrival.index - entryIndex());
          return;
        }
        const { resolve } = arrival;
        arrival = null;
        resolve();
        return;
      }
      const target = entryIndex();
      const delta = target - index;
      if (!delta) {
        return;
      }
      if (traversing) {
        history.go(-delta);
        return;
      }
      const path = location.pathname;
      traversing = true;
      void (async () => {
        try {
          await travel(-delta);
          if (lifetime.disposed) {
            return;
          }
          if ((await navigate(path)) && !lifetime.disposed) {
            await travel(delta);
            index = target;
          }
        } finally {
          traversing = false;
        }
      })();
    },
    { signal: lifetime.signal },
  );
  return {
    commit(id: string | null) {
      if (traversing || lifetime.disposed) {
        return;
      }
      const path = id === null ? `${base}/` : `${base}/scenes/${encodeURIComponent(id)}`;
      if (location.pathname === path) {
        return;
      }
      history.pushState({ forgeSceneIndex: ++index }, '', path);
    },
  };
}
