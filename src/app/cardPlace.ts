export interface CardPlace {
  top: number;
  right: number;
  width: number;
}

export const cardWidth = 360;
const frameGap = 8;

export function cardPlace(
  switchBox: { bottom: number; right: number },
  frameTop: number | null,
  windowWidth: number,
  frameSides: readonly number[] = [],
): CardPlace {
  const below = switchBox.bottom + frameGap;
  const right = switchBox.right;
  let left = right - cardWidth;
  for (const side of frameSides) {
    if (Math.abs(left - side) < frameGap) left = side + frameGap;
  }
  return {
    top: frameTop === null ? below : Math.max(below, frameTop + frameGap),
    right: windowWidth - right,
    width: right - left,
  };
}
