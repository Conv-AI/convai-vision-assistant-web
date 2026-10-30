import { useEffect, useState } from 'react';
import {
  aiColors,
  applyPreferences,
  defaultPreferences,
  type AiColor,
  type KitPreferences,
  type SystemSwitch,
} from '../kit/preferences';
import { CapsuleSection } from './CapsuleSection';
import { ChoicesSection } from './ChoicesSection';
import { ControlsSection } from './ControlsSection';
import { IslandSection } from './IslandSection';
import { LensSection } from './LensSection';
import { tokenGroups, tokenVariable } from './tokenList';
import { useMediaQuery } from './useMediaQuery';

const typeRoles = [
  ['display', 'Display', 'Vision Assistant'],
  ['title', 'Title', 'Settings'],
  ['caption', 'Caption', 'The selector sets the feed rate.'],
  ['caption-question', 'Caption question', 'What does the selector do?'],
  ['heading', 'Heading', 'Talking'],
  ['body', 'Body', 'It matches the gear’s speed to the shaft, then locks them together.'],
  ['row', 'Row', 'Push to talk key'],
  ['control', 'Control', 'Try again'],
  ['meta', 'Meta', 'Hold T to talk'],
  ['micro', 'Micro', 'Live'],
] as const;

const textScales = [0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];
const switches: SystemSwitch[] = ['system', 'on', 'off'];

const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function switchLabel(value: SystemSwitch, systemOn: boolean): string {
  return value === 'system' ? `System (${systemOn ? 'on' : 'off'})` : label(value);
}

/** Writes beside each token what the browser draws, and beside each type role its size and weight. */
function showValues() {
  const root = getComputedStyle(document.documentElement);
  for (const row of document.querySelectorAll<HTMLElement>('[data-token]')) {
    const value = row.querySelector('.gallery__value');
    const swatch = row.querySelector('.gallery__swatch');
    if (!value || !row.dataset.token) continue;
    value.textContent = swatch
      ? getComputedStyle(swatch).backgroundColor
      : root.getPropertyValue(tokenVariable(row.dataset.token)).trim();
  }
  for (const row of document.querySelectorAll<HTMLElement>('[data-role]')) {
    const sample = row.querySelector('.gallery__sample');
    const spec = row.querySelector('.gallery__spec');
    if (!sample || !spec) continue;
    const style = getComputedStyle(sample);
    const tracking = style.letterSpacing === 'normal' ? '' : ` · ${style.letterSpacing}`;
    spec.textContent = `${style.fontSize} / ${style.fontWeight}${tracking}`;
  }
}

export function Gallery() {
  const [preferences, setPreferences] = useState<KitPreferences>(defaultPreferences);
  const systemContrast = useMediaQuery('(prefers-contrast: more)');
  const systemMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => applyPreferences(document.documentElement, preferences), [preferences]);
  // After the classes change, whether from a choice here or from the browser.
  useEffect(() => {
    showValues();
  }, [preferences, systemContrast, systemMotion]);
  const set = (changes: Partial<KitPreferences>) => {
    setPreferences((current) => ({ ...current, ...changes }));
  };

  return (
    <main className="gallery">
      <header className="gallery__header">
        <h1 className="convai-text--title">Kit gallery</h1>
        <p className="convai-text--body convai-tone--secondary">
          The theme’s tokens and type roles, as the browser draws them.
        </p>
        <form className="gallery__preferences" aria-label="Preferences">
          <label className="convai-text--meta">
            Text size
            <select
              value={preferences.textScale}
              onChange={(e) => {
                set({ textScale: Number(e.target.value) });
              }}
            >
              {textScales.map((s) => (
                <option key={s} value={s}>
                  {`${String(Math.round(s * 100))} %`}
                </option>
              ))}
            </select>
          </label>
          <label className="convai-text--meta">
            Character color
            <select
              value={preferences.aiColor}
              onChange={(e) => {
                set({ aiColor: e.target.value as AiColor });
              }}
            >
              {aiColors.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="convai-text--meta">
            Increase contrast
            <select
              value={preferences.highContrast}
              onChange={(e) => {
                set({ highContrast: e.target.value as SystemSwitch });
              }}
            >
              {switches.map((s) => (
                <option key={s} value={s}>
                  {switchLabel(s, systemContrast)}
                </option>
              ))}
            </select>
          </label>
          <label className="convai-text--meta">
            Reduce motion
            <select
              value={preferences.reduceMotion}
              onChange={(e) => {
                set({ reduceMotion: e.target.value as SystemSwitch });
              }}
            >
              {switches.map((s) => (
                <option key={s} value={s}>
                  {switchLabel(s, systemMotion)}
                </option>
              ))}
            </select>
          </label>
        </form>
      </header>

      <section className="gallery__section" aria-labelledby="tokens" data-capture="tokens">
        <h2 id="tokens" className="convai-text--heading">
          Tokens
        </h2>
        <div className="gallery__table">
          <div className="gallery__row gallery__row--head convai-text--meta" aria-hidden="true">
            <span className="gallery__name">Token</span>
            <span className="gallery__frame-column">Drawn</span>
            <span className="gallery__value">Value</span>
            <span className="gallery__backdrop">Backdrop</span>
          </div>
          {tokenGroups.map(({ group, colors, tokens }) => (
            <div key={group} role="group" aria-label={group}>
              <h3 className="gallery__group convai-text--meta">{group}</h3>
              {tokens.map(({ name, backdrop, isNew }) => (
                <div key={name} className="gallery__row" data-token={name}>
                  <span className="gallery__name">
                    <span className="convai-text--control">{name}</span>
                    {isNew && <span className="gallery__new convai-text--micro">New</span>}
                  </span>
                  <span className="gallery__frame-column">
                    {colors && (
                      <span className="gallery__frame">
                        <span
                          className="gallery__swatch"
                          style={{ backgroundColor: `var(${tokenVariable(name)})` }}
                        />
                      </span>
                    )}
                  </span>
                  <code className="gallery__value convai-text--meta" />
                  <span className="gallery__backdrop convai-text--meta">
                    {backdrop ?? (colors ? 'opaque' : '—')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <ControlsSection />

      <ChoicesSection />

      <LensSection />

      <CapsuleSection />

      <IslandSection />

      <section className="gallery__section" aria-labelledby="type" data-capture="type">
        <h2 id="type" className="convai-text--heading">
          Type
        </h2>
        <div className="gallery__table">
          {typeRoles.map(([role, name, sample]) => (
            <div key={role} className="gallery__row gallery__row--type" data-role={role}>
              <span className="gallery__name convai-text--control">{name}</span>
              <span className="gallery__spec convai-text--meta" />
              <span className={`gallery__sample convai-text--${role}`}>{sample}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
