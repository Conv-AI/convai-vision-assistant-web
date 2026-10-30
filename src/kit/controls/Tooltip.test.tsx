import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import { tooltipDelayMs } from './Tooltip';

function otherWindow(height: number) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) throw new Error('no frame document');
  Object.defineProperty(view, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(view, 'innerWidth', { value: 376, configurable: true });
  // Every element of that window lays out as a tooltip does: 80 × 24.
  vi.spyOn(
    (view as unknown as typeof globalThis).HTMLElement.prototype,
    'getBoundingClientRect',
  ).mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 80, height: 24 }));
  return { frame, view, doc };
}

/** Lays the control out at `top` with `height`; the window's other elements keep 80 × 24. */
function layOut(control: Element, top: number, height: number) {
  // Its own property: a spy on the instance would be the prototype's spy, shared with the tooltip.
  Object.defineProperty(control, 'getBoundingClientRect', {
    value: () => DOMRect.fromRect({ x: 8, y: top, width: 32, height }),
  });
}

describe('Tooltip in another window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows in its control’s document, not the page’s', () => {
    const { doc, view } = otherWindow(400);
    const { getByRole } = render(<IconButton label="Mute" icon="mic-off" />, {
      container: doc.body.appendChild(doc.createElement('div')),
    });
    const anchor = getByRole('button', { name: 'Mute' }).parentElement;
    if (!anchor) throw new Error('no anchor');
    layOut(anchor, 200, 32);
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs);
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const tip = doc.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip).toHaveTextContent('Mute');
    expect(tip?.style.top).toBe(`${String(200 - 8 - 24)}px`);
    // Esc in that window closes it.
    fireEvent.keyDown(view, { key: 'Escape' });
    expect(doc.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('stays away in a window with no room above or below its control', () => {
    // The Compact window: 72 high, the capsule's control 32 high in its middle.
    const { doc } = otherWindow(72);
    const { getByRole } = render(<IconButton label="Mute" icon="mic-off" />, {
      container: doc.body.appendChild(doc.createElement('div')),
    });
    const anchor = getByRole('button', { name: 'Mute' }).parentElement;
    if (!anchor) throw new Error('no anchor');
    layOut(anchor, 20, 32);
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs);
    });
    expect(doc.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('goes below its control where only below has room', () => {
    const { doc } = otherWindow(120);
    const { getByRole } = render(<IconButton label="Mute" icon="mic-off" />, {
      container: doc.body.appendChild(doc.createElement('div')),
    });
    const anchor = getByRole('button', { name: 'Mute' }).parentElement;
    if (!anchor) throw new Error('no anchor');
    layOut(anchor, 20, 32);
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs);
    });
    expect(doc.querySelector<HTMLElement>('[role="tooltip"]')?.style.top).toBe(
      `${String(20 + 32 + 8)}px`,
    );
  });
});

describe('Tooltip on keyboard focus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** A focus as the browser draws it after a key: every focus counts as :focus-visible here. */
  function focusAfter(key: string | null, button: HTMLElement) {
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ':focus-visible' ? document.activeElement === this : false;
    });
    if (key === null) fireEvent.pointerDown(document.body);
    else fireEvent.keyDown(document.body, { key });
    act(() => {
      button.focus();
    });
  }

  it('shows at once when Tab or an arrow brought the focus', () => {
    for (const key of ['Tab', 'ArrowRight', 'End']) {
      const { getByRole, unmount } = render(<IconButton label="Settings" icon="settings" />);
      focusAfter(key, getByRole('button', { name: 'Settings' }));
      expect(document.querySelector('[role="tooltip"]'), key).toHaveTextContent('Settings');
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('stays closed when the focus was given back after Esc, Enter or a key of the app', () => {
    for (const key of ['Escape', 'Enter', 'q', 'k']) {
      const { getByRole, unmount } = render(<IconButton label="Settings" icon="settings" />);
      focusAfter(key, getByRole('button', { name: 'Settings' }));
      expect(document.querySelector('[role="tooltip"]'), key).toBeNull();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('forgets a Tab once the pointer is pressed', () => {
    const { getByRole } = render(<IconButton label="Settings" icon="settings" />);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    focusAfter(null, getByRole('button', { name: 'Settings' }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('forgets a Tab once it is let go, before a later key gives a focus back', () => {
    const { getByRole } = render(<IconButton label="Settings" icon="settings" />);
    const button = getByRole('button', { name: 'Settings' });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.keyUp(document.body, { key: 'Tab' });
    // The app's own Esc handler gives the focus back before any listener of the tooltip hears it.
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ':focus-visible' ? document.activeElement === this : false;
    });
    act(() => {
      button.focus();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
