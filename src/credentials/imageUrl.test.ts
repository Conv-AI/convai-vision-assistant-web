import { describe, expect, it } from 'vitest';
import { imageUrl } from './imageUrl';

describe('imageUrl', () => {
  it('preserves signed image queries and trims whitespace', () => {
    expect(imageUrl(' https://images.test/art.png?version=1&signature=example ')).toBe(
      'https://images.test/art.png?version=1&signature=example',
    );
  });
  it.each([
    undefined,
    null,
    5,
    '',
    'NULL',
    'undefined',
    'https://',
    'http://images.test/art.png',
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'https://user:password@images.test/art.png',
  ])('drops invalid or unsafe artwork %j', (value) => {
    expect(imageUrl(value)).toBeNull();
  });
});
