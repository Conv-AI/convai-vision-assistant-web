import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EscapeContext, EscapeStack } from '../escape';
import { Segmented } from './Segmented';
import { Select } from './Select';
import { Slider } from './Slider';
import { stepValue } from './stepValue';
import { Switch } from './Switch';

function Toggle({ start = false }: { start?: boolean }) {
  const [on, setOn] = useState(start);
  return <Switch label="Captions" on={on} onChange={setOn} />;
}

describe('the switch', () => {
  it('is a named switch that a press or Space turns', () => {
    render(<Toggle />);
    const control = screen.getByRole('switch', { name: 'Captions' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('does nothing while disabled', () => {
    const change = vi.fn();
    render(<Switch label="Captions" on={false} onChange={change} disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(change).not.toHaveBeenCalled();
  });
});

function Mode() {
  const [value, setValue] = useState('push');
  return (
    <Segmented
      label="Mode"
      options={[
        { value: 'free', label: 'Hands free' },
        { value: 'push', label: 'Push to talk' },
        { value: 'off', label: 'Off' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

describe('the segmented control', () => {
  it('is one Tab stop whose arrows choose at once, round the ends', () => {
    render(<Mode />);
    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    const radios = screen.getAllByRole('radio');
    const radio = (name: string) => screen.getByRole('radio', { name });
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    const chosen = () => group.querySelector('[aria-checked="true"]')?.textContent;
    fireEvent.keyDown(radio('Push to talk'), { key: 'ArrowRight' });
    expect(chosen()).toBe('Off');
    expect(document.activeElement?.textContent).toBe('Off');
    fireEvent.keyDown(radio('Off'), { key: 'ArrowRight' });
    expect(chosen()).toBe('Hands free');
    fireEvent.keyDown(radio('Hands free'), { key: 'ArrowLeft' });
    expect(chosen()).toBe('Off');
    fireEvent.keyDown(radio('Off'), { key: 'Home' });
    expect(chosen()).toBe('Hands free');
    fireEvent.keyDown(radio('Hands free'), { key: 'End' });
    expect(chosen()).toBe('Off');
    fireEvent.click(screen.getByRole('radio', { name: 'Push to talk' }));
    expect(chosen()).toBe('Push to talk');
  });
});

function Size() {
  const [value, setValue] = useState(1);
  return (
    <Slider
      label="Text size"
      value={value}
      min={0.9}
      max={1.3}
      step={0.05}
      onChange={setValue}
      format={(v) => `${String(Math.round(v * 100))}%`}
    />
  );
}

describe('the slider', () => {
  it('says its value with its unit and steps by the arrows, ten with Shift, to the ends', () => {
    render(<Size />);
    const slider = screen.getByRole('slider', { name: 'Text size' });
    const value = () => slider.getAttribute('aria-valuetext');
    expect(value()).toBe('100%');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(value()).toBe('105%');
    expect(slider).toHaveAttribute('aria-valuenow', '1.05');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(value()).toBe('95%');
    fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true });
    expect(value()).toBe('130%');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(value()).toBe('90%');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(value()).toBe('90%');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(value()).toBe('130%');
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(value()).toBe('90%');
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('lands a value on a step, inside the range, without float dust', () => {
    expect(stepValue(1.03, 0.9, 1.3, 0.05)).toBe(1.05);
    expect(stepValue(0.9 + 3 * 0.05, 0.9, 1.3, 0.05)).toBe(1.05);
    // 3 × 0.1 is 0.30000000000000004 in floating point.
    expect(stepValue(0.3, 0, 1, 0.1)).toBe(0.3);
    expect(stepValue(2, 0.9, 1.3, 0.05)).toBe(1.3);
    expect(stepValue(0.42, 0, 1, 0.05)).toBe(0.4);
    expect(stepValue(-1, 0, 1, 0.05)).toBe(0);
  });
});

function Microphone({ stack }: { stack?: EscapeStack }) {
  const [value, setValue] = useState('');
  const select = (
    <Select
      label="Input device"
      options={[
        { value: '', label: 'Default' },
        { value: 'usb', label: 'Studio USB' },
        { value: 'built-in', label: 'Built-in microphone' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
  return stack ? <EscapeContext value={stack}>{select}</EscapeContext> : select;
}

describe('the select', () => {
  const field = () => screen.getByRole('button', { name: /Input device/ });
  const active = () => {
    const list = screen.getByRole('listbox');
    const id = list.getAttribute('aria-activedescendant') ?? '';
    return document.getElementById(id)?.textContent;
  };

  it('opens on ↓ with the chosen row active, moves, and picks with Enter', () => {
    render(<Microphone />);
    expect(field()).toHaveTextContent('Default');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    expect(document.activeElement).toBe(list);
    expect(active()).toBe('Default');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(active()).toBe('Built-in microphone');
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveTextContent('Built-in microphone');
    expect(document.activeElement).toBe(field());
  });

  it('jumps to a row by its first letters and marks the chosen one', () => {
    render(<Microphone />);
    fireEvent.click(field());
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 's' });
    expect(active()).toBe('Studio USB');
    fireEvent.keyDown(list, { key: ' ' });
    fireEvent.click(field());
    expect(screen.getByRole('option', { name: 'Studio USB' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('closes on Esc without a change, and on Tab, and a press picks a row', () => {
    render(<Microphone />);
    fireEvent.click(field());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveTextContent('Default');
    expect(document.activeElement).toBe(field());
    fireEvent.click(field());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('option', { name: 'Studio USB' }));
    expect(field()).toHaveTextContent('Studio USB');
  });

  it('is the top Esc layer of the surface around it while open', () => {
    const stack = new EscapeStack();
    render(<Microphone stack={stack} />);
    expect(stack.closeTop()).toBe(false);
    fireEvent.click(field());
    let closed = false;
    act(() => {
      closed = stack.closeTop();
    });
    expect(closed).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(stack.closeTop()).toBe(false);
  });
});

describe('the Esc stack', () => {
  it('closes the newest layer first, and forgets a layer taken away', () => {
    const stack = new EscapeStack();
    const closed: string[] = [];
    stack.push(() => closed.push('menu'));
    const removeTop = stack.push(() => closed.push('question'));
    expect(stack.closeTop()).toBe(true);
    removeTop();
    expect(stack.closeTop()).toBe(true);
    expect(closed).toEqual(['question', 'menu']);
  });
});
