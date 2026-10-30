export type SystemSwitch = 'system' | 'on' | 'off';

/** The character colors the Convai theme offers (`ai.accent.options`). */
export const aiColors = ['mint', 'cyan', 'yellow'] as const;
export type AiColor = (typeof aiColors)[number];

export interface KitPreferences {
  /** 0.90 to 1.30 in steps of 0.05; other values are brought into that range. */
  textScale: number;
  aiColor: AiColor;
  highContrast: SystemSwitch;
  reduceMotion: SystemSwitch;
}

export const defaultPreferences: KitPreferences = {
  textScale: 1,
  aiColor: 'mint',
  highContrast: 'system',
  reduceMotion: 'system',
};

export const minTextScale = 0.9;
export const maxTextScale = 1.3;

/** The text size the kit draws for `value`: the nearest 0.05 step from 0.90 to 1.30. */
export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return defaultPreferences.textScale;
  const stepped = Math.round(value * 20) / 20;
  return Math.min(maxTextScale, Math.max(minTextScale, stepped));
}

type MediaQuery = (
  query: string,
) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;

const contrastQuery = '(prefers-contrast: more)';
/** The browser's own Reduce Motion, which "System" follows. */
export const motionQuery = '(prefers-reduced-motion: reduce)';

function resolve(setting: SystemSwitch, system: boolean): boolean {
  return setting === 'system' ? system : setting === 'on';
}

/**
 * Whether motion is reduced for `setting`: On and Off as chosen, System as the browser asks. The
 * same answer `applyPreferences` gives the root, for code that must know before the root has it.
 */
export function reducesMotion(
  setting: SystemSwitch,
  matchMedia: MediaQuery = (query) => window.matchMedia(query),
): boolean {
  return resolve(setting, setting === 'system' && matchMedia(motionQuery).matches);
}

/**
 * Applies `preferences` to `root`, which must carry the `convai-theme` class, and keeps the "system"
 * settings in step with the browser until the returned function is called.
 */
export function applyPreferences(
  root: HTMLElement,
  preferences: KitPreferences,
  matchMedia: MediaQuery = (query) => window.matchMedia(query),
): () => void {
  const contrast = matchMedia(contrastQuery);
  const motion = matchMedia(motionQuery);

  const update = () => {
    root.style.setProperty('--convai-text-scale', String(clampTextScale(preferences.textScale)));
    for (const color of aiColors) {
      root.classList.toggle(
        `convai-ai--${color}`,
        color !== 'mint' && color === preferences.aiColor,
      );
    }
    root.classList.toggle(
      'convai-high-contrast',
      resolve(preferences.highContrast, contrast.matches),
    );
    root.classList.toggle(
      'convai-reduce-motion',
      resolve(preferences.reduceMotion, motion.matches),
    );
  };

  update();
  contrast.addEventListener('change', update);
  motion.addEventListener('change', update);
  return () => {
    contrast.removeEventListener('change', update);
    motion.removeEventListener('change', update);
  };
}
