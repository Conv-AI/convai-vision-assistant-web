import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Island } from './Island';
import { request } from './notification';
import { NotificationQueue } from './queue';

/** A menu that takes the focus as it opens, as the app's menus do. */
function Menu() {
  const row = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    row.current?.focus();
  }, []);
  return (
    <button ref={row} type="button">
      Row
    </button>
  );
}

/** The action asks the page for its menu with this event. */
const openMenu = 'test-open-menu';

/** The page: a control the focus came from, a menu an action can open, and the Island. */
function Page({ queue }: { queue: NotificationQueue }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const listener = () => {
      setOpen(true);
    };
    window.addEventListener(openMenu, listener);
    return () => {
      window.removeEventListener(openMenu, listener);
    };
  }, []);
  return (
    <>
      <button type="button">From</button>
      {open && <Menu />}
      <Island queue={queue} />
    </>
  );
}

function setup(opens: boolean) {
  const queue = new NotificationQueue(() => performance.now() / 1000);
  queue.post(
    request('k', 'Camera blocked', 'Allow it.', {
      label: 'Act',
      run: () => {
        if (opens) window.dispatchEvent(new Event(openMenu));
      },
    }),
  );
  render(<Page queue={queue} />);
  const from = screen.getByRole('button', { name: 'From' });
  act(() => {
    from.focus();
  });
  act(() => {
    screen.getByRole('button', { name: 'Act' }).focus();
  });
  return { from };
}

describe('Island focus', () => {
  it('gives the focus back to where it came from when an action leaves it on the page', () => {
    const { from } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(from).toHaveFocus();
  });

  it('leaves the focus where the action’s own change put it, such as a menu it opened', () => {
    setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(screen.getByRole('button', { name: 'Row' })).toHaveFocus();
  });
});

/** A page that holds the queue while its prop says so and draws the Island differently meanwhile. */
function Holding({ queue, held }: { queue: NotificationQueue; held: boolean }) {
  useEffect(() => (held ? queue.hold(() => false) : undefined), [held, queue]);
  return <Island queue={queue} overPicture={held} />;
}

describe('the Island and a hold', () => {
  it('shows what waited once the hold is lifted in the same commit that redraws the Island', () => {
    // The app's crop: closing it lifts the hold in an effect's cleanup while the Island re-renders
    // with another prop; the change must still reach the Island.
    const queue = new NotificationQueue(() => performance.now() / 1000);
    const { rerender } = render(<Holding queue={queue} held />);
    act(() => {
      queue.post(
        request('k', 'Camera blocked', 'Allow it.', { label: 'Act', run: () => undefined }),
      );
    });
    expect(screen.queryByText('Camera blocked')).toBeNull();
    rerender(<Holding queue={queue} held={false} />);
    expect(queue.current?.key).toBe('k');
    expect(screen.getAllByText('Camera blocked').length).toBeGreaterThan(0);
  });
});
