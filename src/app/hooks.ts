import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { CharacterList, CharacterListState } from '../characters/list';
import type { Compact, CompactState } from '../compact/compact';
import { formOf } from '../kit/island/notification';
import { motionQuery, reducesMotion } from '../kit/preferences';
import type { NotificationQueue } from '../kit/island/queue';
import type { Session, SessionState } from '../session/session';
import type { SettingsStore } from '../settings/stored';
import type { Vision, VisionState } from '../vision/vision';

/** What is shared, re-read whenever it changes. */
export function useVisionState(vision: Vision): VisionState {
  return useSyncExternalStore(
    (onChange) => vision.subscribe(onChange),
    () => vision.state,
  );
}

/** True while the Island shows the notification with `key` (not when it waits or is on the dot). */
export function useIslandShows(queue: NotificationQueue, key: string): boolean {
  return useSyncExternalStore(
    (onChange) => queue.subscribe(onChange),
    () => queue.current?.key === key,
  );
}

/** True while any notification with one of `keys` is on the Island, shown, waiting or on the dot. */
export function useIslandHolds(queue: NotificationQueue, keys: readonly string[]): boolean {
  return useSyncExternalStore(
    (onChange) => queue.subscribe(onChange),
    () => keys.some((key) => queue.contains(key)),
  );
}

export function useIslandBanner(queue: NotificationQueue): boolean {
  return useSyncExternalStore(
    (onChange) => queue.subscribe(onChange),
    () => {
      const current = queue.current;
      return current !== null && formOf(current).startsWith('banner');
    },
  );
}

/** Full window or Compact, re-read whenever it changes. */
export function useCompactState(compact: Compact): CompactState {
  return useSyncExternalStore(
    (onChange) => compact.subscribe(onChange),
    () => compact.state,
  );
}

/**
 * Whether motion is reduced, from the stored choice and the browser's own setting, re-read when
 * either changes. Right from the first render, before the root carries `convai-reduce-motion`.
 */
export function useReducedMotion(settings: SettingsStore): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const system = window.matchMedia(motionQuery);
      const stop = settings.subscribe(onChange);
      system.addEventListener('change', onChange);
      return () => {
        stop();
        system.removeEventListener('change', onChange);
      };
    },
    () => reducesMotion(settings.state.reduceMotion),
  );
}

/** The characters offered, re-read whenever the list changes. */
export function useCharacterList(list: CharacterList): CharacterListState {
  return useSyncExternalStore(
    (onChange) => list.subscribe(onChange),
    () => list.state,
  );
}

/** The session's state, re-read whenever it changes. */
export function useSessionState(session: Session): SessionState {
  return useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.state,
  );
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/** The window's inner width, re-read on every resize. */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth);
}

/**
 * Holds a video's last frame while `still` (Pause vision keeps the picture for the person and sends
 * nothing), and plays it again after.
 */
export function useHeldStill(video: RefObject<HTMLVideoElement | null>, still: boolean): void {
  useEffect(() => {
    const element = video.current;
    if (!element || !still) return;
    element.pause();
    return () => {
      Promise.resolve()
        .then(() => element.play())
        .catch(() => undefined);
    };
  }, [video, still]);
}

/**
 * An element's laid-out height, followed as it changes; 0 until it is laid out, or where the
 * browser cannot tell (no ResizeObserver).
 */
export function useHeight(element: RefObject<HTMLElement | null>, present = true): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const target = element.current;
    if (!present || !target || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setHeight(target.getBoundingClientRect().height);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [element, present]);
  return height;
}
