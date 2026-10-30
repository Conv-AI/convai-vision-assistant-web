import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Portrait } from './Portrait';

describe('Portrait', () => {
  it('shows the picture, with no text of its own', () => {
    const { container } = render(<Portrait src="https://cdn.example/kira.png">K</Portrait>);
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example/kira.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(screen.queryByText('K')).toBeNull();
  });

  it('shows the stand-in when there is no picture', () => {
    const { container } = render(<Portrait src={null}>K</Portrait>);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('K')).toBeTruthy();
  });

  it('shows the stand-in when the picture cannot load, and tries a new picture again', () => {
    const { container, rerender } = render(
      <Portrait src="https://cdn.example/gone.png">K</Portrait>,
    );
    const image = container.querySelector('img');
    if (!image) throw new Error('No picture.');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('K')).toBeTruthy();

    rerender(<Portrait src="https://cdn.example/elena.png">E</Portrait>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example/elena.png',
    );
  });
});
