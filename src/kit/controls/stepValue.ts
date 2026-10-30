/** `value` on the nearest step from `min`, inside the range. */
export function stepValue(value: number, min: number, max: number, step: number): number {
  const steps = Math.round((value - min) / step);
  // Rounded to the step's own decimals, so 0.9 + 3 × 0.05 is 1.05 and not 1.0500000000000003.
  const decimals = (String(step).split('.')[1] ?? '').length;
  const stepped = Number((min + steps * step).toFixed(decimals));
  return Math.min(max, Math.max(min, stepped));
}
