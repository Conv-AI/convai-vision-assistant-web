import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { tooltipDelayMs } from './Tooltip';

describe('Button', () => {
  it('is a secondary, standard button by default', () => {
    render(<Button>Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveClass('convai-button--secondary', 'convai-button--standard');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('runs its action on a press', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Allow</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves the Tab order when disabled without a reason', () => {
    render(<Button disabled>Allow</Button>);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  });

  it('stays focusable, reads its reason and ignores presses when disabled with a reason', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button kind="primary" disabled reasonId="reason" onClick={onClick}>
          Continue
        </Button>
        <p id="reason">Allow the microphone to continue</p>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Allow the microphone to continue');
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('says it is busy and takes no press while loading, keeping its words for its name', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.convai-spinner')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('never makes a primary red', () => {
    render(
      <Button kind="primary" danger>
        Delete
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveClass('convai-button--danger');
  });

  it('draws the extra-large size as a capsule', () => {
    render(<Button size="extra-large">Start</Button>);
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('convai-button--capsule');
  });

  it('shows its key as a cap that is not part of its name, and names the key for screen readers', () => {
    render(<Button keyCap="T">Hold to talk</Button>);
    const button = screen.getByRole('button', { name: 'Hold to talk' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'T');
    const cap = screen.getByText('T');
    expect(cap.tagName).toBe('KBD');
    expect(cap).toHaveClass('convai-key-cap--single');
  });

  it('reads as busy, not unavailable, while loading', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('IconButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is named by its label, never its glyph', () => {
    render(<IconButton label="Settings" icon="settings" />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('reports a toggle as pressed', () => {
    render(<IconButton label="Mute" icon="mic-off" pressed />);
    expect(screen.getByRole('button', { name: 'Mute', pressed: true })).toBeInTheDocument();
  });

  it('shows its tooltip after 600 ms under the pointer and hides it on leave', () => {
    render(<IconButton label="Transcript" icon="transcript" shortcut="R" />);
    const anchor = screen.getByRole('button', { name: 'Transcript' }).parentElement;
    if (!anchor) throw new Error('no anchor');
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs - 1);
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip).toHaveTextContent('TranscriptR');
    fireEvent.pointerLeave(anchor);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('says why it is disabled in its tooltip and its description, and stays focusable', () => {
    render(
      <IconButton label="Share camera" icon="cam" disabled reason="Connect a camera to share it" />,
    );
    const button = screen.getByRole('button', { name: 'Share camera' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Connect a camera to share it');
    const anchor = button.parentElement;
    if (!anchor) throw new Error('no anchor');
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs);
    });
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(
      'Connect a camera to share it',
    );
  });

  it('closes its tooltip on Esc', () => {
    render(<IconButton label="Transcript" icon="transcript" />);
    const anchor = screen.getByRole('button', { name: 'Transcript' }).parentElement;
    if (!anchor) throw new Error('no anchor');
    fireEvent.pointerEnter(anchor);
    act(() => {
      vi.advanceTimersByTime(tooltipDelayMs);
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
