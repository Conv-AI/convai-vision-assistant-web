import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { FirstRun } from './app/FirstRun';
import { createRuntime } from './app/runtime';
import { SessionWindow } from './app/SessionWindow';
import { applyPreferences } from './kit/preferences';

export function App() {
  const [runtime] = useState(createRuntime);
  const [firstRun, setFirstRun] = useState(() => !runtime.firstRun.isDone);

  useEffect(() => {
    if (firstRun) return;
    void runtime.session.start();
    runtime.vision.start();
    return () => {
      runtime.vision.dispose();
      void runtime.session.dispose();
    };
  }, [runtime, firstRun]);

  // Text size, contrast, motion: what Settings keeps, applied before the frame that shows a change,
  // with "System" following the browser.
  const settings = useSyncExternalStore(
    (onChange) => runtime.settings.subscribe(onChange),
    () => runtime.settings.state,
  );
  useLayoutEffect(() => applyPreferences(document.documentElement, settings), [settings]);

  return firstRun ? (
    <FirstRun
      runtime={runtime}
      onDone={() => {
        setFirstRun(false);
      }}
    />
  ) : (
    <SessionWindow runtime={runtime} />
  );
}
