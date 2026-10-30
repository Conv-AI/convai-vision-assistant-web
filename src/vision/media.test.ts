import { describe, expect, it } from 'vitest';
import { coverCut, stillSize } from './media';

describe('a turn’s still', () => {
  it('is twice the 64 × 40 the transcript draws', () => {
    expect(stillSize).toEqual({ width: 128, height: 80 });
  });

  it('fills the still from the middle of a wider picture, keeping its aspect', () => {
    expect(coverCut({ width: 1920, height: 1080 }, stillSize)).toEqual({
      x: 96,
      y: 0,
      width: 1728,
      height: 1080,
    });
  });

  it('fills the still from the middle of a taller picture', () => {
    expect(coverCut({ width: 800, height: 1000 }, stillSize)).toEqual({
      x: 0,
      y: 250,
      width: 800,
      height: 500,
    });
  });

  it('takes a picture of the still’s own shape whole', () => {
    expect(coverCut({ width: 1280, height: 800 }, stillSize)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    });
  });
});
