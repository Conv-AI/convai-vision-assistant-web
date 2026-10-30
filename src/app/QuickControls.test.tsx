import { createRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Step } from '../quick/layout';
import { appTiles, packageTiles, type QuickState } from '../quick/tiles';
import { QuickControls } from './QuickControls';

const state: QuickState = {
  name: 'Kira',
  talkMode: 'push-to-talk',
  captions: true,
  transcriptOpen: false,
  continuum: false,
  muted: false,
  microphoneMissing: false,
  textScale: 1,
  typeKey: '/',
  paused: false,
  pauseBlocked: { cause: 'nothing', detail: 'Share something to pause vision' },
  sourceKind: null,
  windowTile: true,
  windowMode: 'full',
};

function setup(
  options: { step?: Step; compactExplains?: boolean; given?: Partial<QuickState> } = {},
) {
  const anchor = createRef<HTMLDivElement>();
  const escapeRef = createRef<(() => boolean) | null>() as { current: (() => boolean) | null };
  const handlers = {
    onTile: vi.fn(),
    onWindow: vi.fn(),
    onTextSize: vi.fn(),
    onChange: vi.fn(),
    onSettings: vi.fn(),
    onClose: vi.fn(),
  };
  const shown = { ...state, ...options.given };
  render(
    <div>
      <div ref={anchor} data-testid="anchor" />
      <button type="button">Elsewhere</button>
      <QuickControls
        name="Kira"
        portrait={null}
        line="English"
        packageTiles={packageTiles(shown)}
        appTiles={appTiles(shown)}
        step={options.step ?? 0}
        columns={3}
        width={420}
        textScale={1}
        overPicture={false}
        settingsKeys="Ctrl ,"
        windowMode="full"
        compactExplains={options.compactExplains ?? false}
        anchor={anchor}
        escapeRef={escapeRef}
        {...handlers}
      />
    </div>,
  );
  return { escapeRef, handlers };
}

const panel = () => screen.getByRole('dialog', { name: 'Quick controls' });
/** The panel's own Esc, as the window calls it. */
function escape(ref: { current: (() => boolean) | null }): boolean | undefined {
  let took: boolean | undefined;
  act(() => {
    took = ref.current?.();
  });
  return took;
}

const tile = (name: RegExp) => within(panel()).getByRole('button', { name });
const tiles = () =>
  [...panel().querySelectorAll<HTMLElement>('[data-tile]')].map((each) => each.dataset.tile);

describe('QuickControls', () => {
  it('is a panel named Quick controls, focused on its first tile', () => {
    setup();
    expect(tile(/^Hands free/)).toHaveFocus();
    expect(within(panel()).getByText('Kira')).toBeInTheDocument();
    expect(within(panel()).getByText('English')).toBeInTheDocument();
    expect(within(panel()).getByText('From Vision Assistant')).toBeInTheDocument();
  });

  it('presses a toggle as a toggle, and hears On or Off as its state, not its words', () => {
    const { handlers } = setup();
    const captions = tile(/^Captions/);
    expect(captions).toHaveAttribute('aria-pressed', 'true');
    expect(captions).toHaveAccessibleName('Captions');
    fireEvent.click(captions);
    expect(handlers.onTile).toHaveBeenCalledWith('captions');
    // An action carries no pressed state and is named with its value.
    expect(tile(/^Source/)).not.toHaveAttribute('aria-pressed');
    expect(tile(/^Source/)).toHaveAccessibleName('Source Nothing');
  });

  it('does nothing for a dimmed tile, which keeps its reason in its name', () => {
    const { handlers } = setup();
    const pause = tile(/^Pause vision/);
    expect(pause).toHaveAttribute('aria-disabled', 'true');
    // The short reason on its line is heard with the name; the whole sentence as its description.
    expect(pause).toHaveAccessibleName('Pause vision Nothing shared');
    expect(pause).toHaveAccessibleDescription('Share something to pause vision');
    fireEvent.click(pause);
    expect(handlers.onTile).not.toHaveBeenCalled();
  });

  it('gives way by whole rows: the second row, the character, then all but All settings', () => {
    setup({ step: 1 });
    expect(tiles()).toEqual([
      'hands-free',
      'captions',
      'transcript',
      'pause-vision',
      'source',
      'window',
    ]);
    expect(within(panel()).getByText('English')).toBeInTheDocument();
  });

  it('leaves the character out at the second step', () => {
    setup({ step: 2 });
    expect(within(panel()).queryByText('English')).toBeNull();
    expect(tiles()).toHaveLength(6);
  });

  it('stands as All settings alone at the last step, focused there', () => {
    const { handlers } = setup({ step: 3 });
    expect(tiles()).toEqual([]);
    expect(panel().querySelector('[role="separator"]')).toBeNull();
    const settings = within(panel()).getByRole('button', { name: 'All settings' });
    expect(settings).toHaveFocus();
    // Both chords open Settings on every system, as the gear names them.
    expect(settings).toHaveAttribute('aria-keyshortcuts', 'Control+, Meta+,');
    fireEvent.click(settings);
    expect(handlers.onSettings).toHaveBeenCalled();
  });

  it('makes the tiles one Tab stop, the one last focused', () => {
    setup();
    const stops = () =>
      [...panel().querySelectorAll<HTMLElement>('[data-tile]')]
        .filter((each) => each.tabIndex === 0)
        .map((each) => each.dataset.tile);
    expect(stops()).toEqual(['hands-free']);
    fireEvent.keyDown(tile(/^Hands free/), { key: 'ArrowRight' });
    expect(tile(/^Captions/)).toHaveFocus();
    expect(stops()).toEqual(['captions']);
    // Change and All settings stay in the Tab order.
    expect(within(panel()).getByRole('button', { name: 'Change' }).tabIndex).toBe(0);
    expect(within(panel()).getByRole('button', { name: 'All settings' }).tabIndex).toBe(0);
  });

  it('closes when the focus leaves for the page, not for the capsule or nowhere', () => {
    const { handlers } = setup();
    const anchor = screen.getByTestId('anchor');
    anchor.tabIndex = -1;
    act(() => {
      anchor.focus();
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
    act(() => {
      tile(/^Mute/).focus();
    });
    act(() => {
      tile(/^Mute/).blur();
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
    act(() => {
      tile(/^Mute/).focus();
    });
    act(() => {
      screen.getByRole('button', { name: 'Elsewhere' }).focus();
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('opens Text size’s options in place, by a press, →, or a right-click, and Esc returns', () => {
    const { escapeRef, handlers } = setup();
    fireEvent.click(tile(/^Text size/));
    const slider = within(panel()).getByRole('slider', { name: 'Text size' });
    expect(slider).toHaveFocus();
    expect(handlers.onTile).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(handlers.onTextSize).toHaveBeenCalledWith(1.05);
    expect(escape(escapeRef)).toBe(true);
    expect(tile(/^Text size/)).toHaveFocus();
    expect(escape(escapeRef)).toBe(false);

    fireEvent.keyDown(tile(/^Text size/), { key: 'ArrowRight' });
    expect(within(panel()).getByRole('slider')).toBeInTheDocument();
    // ← from anywhere but the slider goes back.
    fireEvent.keyDown(within(panel()).getByRole('button', { name: 'Back' }), { key: 'ArrowLeft' });
    expect(tile(/^Text size/)).toHaveFocus();
    fireEvent.contextMenu(tile(/^Text size/));
    expect(within(panel()).getByRole('slider')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Back' }));
    expect(tile(/^Text size/)).toHaveFocus();
  });

  it('opens the Window menu with the mode in force checked, and a choice goes to the window', () => {
    const { escapeRef, handlers } = setup();
    const window = tile(/^Window/);
    expect(window).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(window);
    expect(window).toHaveAttribute('aria-expanded', 'true');
    const menu = within(panel()).getByRole('menu', { name: 'Window' });
    expect(within(menu).getByRole('menuitemradio', { name: 'Full' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'Full' })).toHaveFocus();
    // Esc closes the menu alone, back on its tile.
    expect(escape(escapeRef)).toBe(true);
    expect(within(panel()).queryByRole('menu')).toBeNull();
    expect(tile(/^Window/)).toHaveFocus();
    fireEvent.click(tile(/^Window/));
    fireEvent.click(within(panel()).getByRole('menuitemradio', { name: 'Compact' }));
    expect(handlers.onWindow).toHaveBeenCalledWith('compact');
  });

  it('offers Compact… as an action where Compact only opens the card (V11)', () => {
    const { handlers } = setup({ compactExplains: true });
    fireEvent.click(tile(/^Window/));
    const compact = within(panel()).getByRole('menuitem', { name: 'Compact…' });
    expect(compact).not.toHaveAttribute('aria-checked');
    fireEvent.click(compact);
    expect(handlers.onWindow).toHaveBeenCalledWith('compact');
  });

  it('closes on a press outside, and leaves a press on the capsule to the capsule', () => {
    const { handlers } = setup();
    fireEvent.pointerDown(screen.getByTestId('anchor'));
    fireEvent.pointerDown(tile(/^Captions/));
    expect(handlers.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the Window menu on a press beside it, inside the panel, and stays open', () => {
    const { handlers } = setup();
    fireEvent.click(tile(/^Window/));
    fireEvent.pointerDown(tile(/^Captions/));
    expect(within(panel()).queryByRole('menu')).toBeNull();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('moves in the grid with the arrows, into the app’s row', () => {
    setup();
    fireEvent.keyDown(tile(/^Hands free/), { key: 'ArrowDown' });
    expect(tile(/^Type/)).toHaveFocus();
    fireEvent.keyDown(tile(/^Type/), { key: 'ArrowDown' });
    expect(tile(/^Pause vision/)).toHaveFocus();
    fireEvent.keyDown(tile(/^Pause vision/), { key: 'ArrowRight' });
    expect(tile(/^Source/)).toHaveFocus();
  });

  it('names the Type key with its cap on the value line, and Change opens the picker', () => {
    const { handlers } = setup();
    expect(tile(/^Type/)).toHaveAttribute('aria-keyshortcuts', '/');
    expect(within(tile(/^Type/)).getByText('/')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Change' }));
    expect(handlers.onChange).toHaveBeenCalled();
  });
});
