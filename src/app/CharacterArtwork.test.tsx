import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CharacterArtwork } from './CharacterArtwork';

const character = {
  id: 'one',
  name: 'Kira',
  languages: [],
  portrait: 'https://images.test/square.png',
  portraitFull: 'https://images.test/full.png',
  background: 'https://images.test/background.png',
};

describe('CharacterArtwork', () => {
  it('loads gallery layers lazily and uses the full uncropped artwork for the preview', () => {
    const { container, rerender } = render(<CharacterArtwork character={character} initial="K" />);
    expect(container.querySelector('.va-artwork__foreground')?.getAttribute('src')).toBe(
      character.portrait,
    );
    expect(container.querySelectorAll('img[loading="lazy"]')).toHaveLength(2);
    rerender(<CharacterArtwork character={character} initial="K" preview />);
    expect(container.querySelector('.va-artwork__foreground')?.getAttribute('src')).toBe(
      character.portraitFull,
    );
    expect(container.querySelector('.va-artwork__foreground')?.hasAttribute('data-full')).toBe(
      true,
    );
    expect(container.querySelectorAll('img[loading="eager"]')).toHaveLength(2);
  });

  it('falls through failed portraits while preserving the background and then the initial', () => {
    const { container } = render(<CharacterArtwork character={character} initial="K" preview />);
    const foreground = () => {
      const image = container.querySelector('.va-artwork__foreground');
      if (!image) throw new Error('The foreground image is missing.');
      return image;
    };
    fireEvent.error(foreground());
    expect(foreground().getAttribute('src')).toBe(character.portrait);
    fireEvent.load(foreground());
    expect(container.querySelector('.va-artwork__initial')).toBeNull();
    fireEvent.error(foreground());
    expect(container.querySelector('.va-artwork__initial')?.textContent).toBe('K');
    expect(container.querySelector('.va-artwork__background')).not.toBeNull();
  });

  it('isolates background failures and resets failed art when switching characters', () => {
    const { container, rerender } = render(<CharacterArtwork character={character} initial="K" />);
    const background = container.querySelector('.va-artwork__background');
    if (!background) throw new Error('The background image is missing.');
    fireEvent.error(background);
    expect(container.querySelector('.va-artwork__background')).toBeNull();
    expect(container.querySelector('.va-artwork__foreground')).not.toBeNull();
    rerender(
      <CharacterArtwork
        character={{
          ...character,
          background: 'https://images.test/new.png',
          portrait: 'https://images.test/new-square.png',
        }}
        initial="E"
      />,
    );
    expect(container.querySelector('.va-artwork__background')?.getAttribute('src')).toBe(
      'https://images.test/new.png',
    );
    expect(container.querySelector('.va-artwork__foreground')?.getAttribute('src')).toBe(
      'https://images.test/new-square.png',
    );
  });
});
