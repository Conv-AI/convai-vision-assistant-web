import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tip, TipHalo } from './Tip';
import { bindTipLine } from './words';

const noBreakSpace = String.fromCharCode(160);

describe('Tip', () => {
  it('draws the title around its key cap and the line, hidden from a screen reader', () => {
    const { container } = render(
      <Tip
        title="Hold"
        keyCap="T"
        titleAfter="to talk"
        line="Let go to send."
        side="above"
        tailOffset={28}
      />,
    );
    const tip = container.querySelector('.convai-tip');
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
    expect(tip?.className).toBe('convai-tip convai-tip--above');
    expect(container.querySelector('.convai-tip__key')?.textContent).toBe('T');
    expect(container.querySelector('.convai-tip__title')?.textContent).toBe('HoldTto talk');
    expect(container.querySelector('.convai-tip__line')?.textContent).toBe(
      `Let go to${noBreakSpace}send.`,
    );
    expect(container.querySelector<HTMLElement>('.convai-tip__tail')?.style.left).toBe('28px');
  });

  it('grows out of its tail, and takes edge.onLight over a picture', () => {
    const { container } = render(
      <Tip keyCap="Esc" titleAfter="to stop" side="left" tailOffset={20} overPicture leaving />,
    );
    const tip = container.querySelector<HTMLElement>('.convai-tip');
    expect(tip?.className).toBe(
      'convai-tip convai-tip--left convai-tip--over-picture convai-tip--leaving',
    );
    expect(tip?.style.transformOrigin).toBe('100% 27px');
    expect(container.querySelector<HTMLElement>('.convai-tip__tail')?.style.top).toBe('20px');
    expect(container.querySelector('.convai-tip__line')).toBeNull();
  });
});

describe('TipHalo', () => {
  it('stands over its target’s box in its own shape', () => {
    const { container } = render(
      <TipHalo box={{ left: 325, top: 810, width: 44, height: 44 }} radius="50%" />,
    );
    const halo = container.querySelector<HTMLElement>('.convai-tip-halo');
    expect(halo?.style.cssText).toContain('left: 325px');
    expect(halo?.style.borderRadius).toBe('50%');
    expect(halo?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('bindTipLine', () => {
  it('keeps a, an and the with the next word, and no lone last word', () => {
    expect(bindTipLine('Everything you and Kira said.')).toBe(
      `Everything you and Kira${noBreakSpace}said.`,
    );
    expect(bindTipLine('Share the camera and ask a question now.')).toBe(
      `Share the${noBreakSpace}camera and ask a${noBreakSpace}question${noBreakSpace}now.`,
    );
  });
});
