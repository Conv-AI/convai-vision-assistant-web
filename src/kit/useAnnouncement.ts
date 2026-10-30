import { useEffect, useState } from 'react';

/** How long a state must hold before it is announced, so quick changes do not pile up. */
export const announceDelayMs = 500;

/**
 * The text a polite live region should hold for `text`: it follows `text` once it has held for
 * `delay` ms, so listening, held and thinking in quick turn announce only where they settle.
 */
export function useAnnouncement(text: string, delay = announceDelayMs): string {
  const [spoken, setSpoken] = useState(text);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSpoken(text);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, delay]);
  return spoken;
}
