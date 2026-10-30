import { describe, expect, it } from 'vitest';
import { placeTip } from './place';

const window1440 = { width: 1440, height: 900 };

const lens = { left: 325, top: 810, width: 44, height: 44 };
const bubble = { width: 144, height: 68 };

describe('placeTip', () => {
  it('stands over the Lens as the layout requires: left 312, 16 above, the tail 28 in', () => {
    expect(placeTip(lens, bubble, window1440)).toEqual({
      side: 'above',
      left: 312,
      top: 810 - 16 - 68,
      tailOffset: 28,
    });
  });

  it('keeps 16 inside the window, the tail moving to keep pointing at the centre', () => {
    const nearLeft = { left: 4, top: 810, width: 44, height: 44 };
    const place = placeTip(nearLeft, bubble, window1440);
    expect(place.left).toBe(16);
    // The Lens centre (26) less the bubble's left (16) less half the tail (7) is 3: held 10 in.
    expect(place.tailOffset).toBe(10);
    const nearRight = { left: 1420, top: 810, width: 20, height: 20 };
    const right = placeTip(nearRight, bubble, window1440);
    expect(right.left).toBe(1440 - 16 - 144);
    expect(right.tailOffset).toBe(144 - 10 - 14);
  });

  it('goes below a target near the top (the bar’s Transcript tool), tail on top', () => {
    const tool = { left: 1300, top: 8, width: 32, height: 32 };
    const place = placeTip(tool, bubble, window1440);
    expect(place.side).toBe('below');
    expect(place.top).toBe(8 + 32 + 16);
    expect(place.left + place.tailOffset + 7).toBe(1316);
  });

  it('stands beside the capsule, left of it, when the inset preview is in the way (0.43.0)', () => {
    const capsule = { left: 510, top: 800, width: 420, height: 64 };
    const target = { left: 521, top: 810, width: 44, height: 44 };
    const preview = { left: 300, top: 120, width: 840, height: 660 };
    const place = placeTip(target, bubble, window1440, [preview, capsule]);
    expect(place.side).toBe('left');
    expect(place.left + 144).toBe(521 - 16);
    // The tail points at the Lens centre (832).
    expect(place.top + place.tailOffset + 7).toBe(832);
  });

  it('takes the side with more room, and above where nothing is clear', () => {
    const target = { left: 1200, top: 400, width: 44, height: 44 };
    const everywhere = { left: 0, top: 0, width: 1440, height: 900 };
    expect(placeTip(target, bubble, window1440, [{ ...everywhere, height: 390 }]).side).toBe(
      'below',
    );
    const blocked = placeTip(target, bubble, window1440, [everywhere]);
    expect(blocked.side).toBe('above');
  });

  it('keeps 6 off the capsule a target sits in, however low the target sits (text 1.30)', () => {
    // At 1.30 the capsule grows to 83 and starts at 781; the Lens stays 44, its top at 799.
    const capsule = { left: 314, top: 781, width: 420, height: 83 };
    const low = { left: 325, top: 799, width: 44, height: 44 };
    const place = placeTip(low, bubble, window1440, [], capsule);
    expect(place.side).toBe('above');
    expect(place.top + bubble.height).toBe(781 - 6);
    // At 1.00 the frame's own numbers: 16 over the Lens is also 6 over the capsule.
    const frame = placeTip(lens, bubble, window1440, [], { ...capsule, top: 800, height: 64 });
    expect(frame.top + bubble.height).toBe(810 - 16);
    // A tool high in its bar keeps the 16 over itself.
    const tool = { left: 620, top: 816, width: 32, height: 32 };
    expect(placeTip(tool, bubble, window1440, [], { ...capsule, top: 800, height: 64 }).top).toBe(
      800 - 6 - 68,
    );
  });

  it('never stands beside its target over the capsule it sits in', () => {
    const capsule = { left: 300, top: 400, width: 420, height: 64 };
    const target = { left: 311, top: 410, width: 44, height: 44 };
    const blocked = { left: 0, top: 0, width: 1440, height: 395 };
    // Above is taken, below too: the right side would stand over the capsule, so left it is.
    const below = { left: 0, top: 470, width: 1440, height: 430 };
    expect(placeTip(target, bubble, window1440, [blocked, below], capsule).side).toBe('left');
  });
});
