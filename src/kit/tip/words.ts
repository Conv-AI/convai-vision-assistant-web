import { bindLastWords } from '../island/notification';

const noBreakSpace = String.fromCharCode(160);

/**
 * A tip's line as the kit binds it (Tip README, Do / don't): "a", "an" and "the" stay with the next
 * word, and the last word never stands alone.
 */
export function bindTipLine(line: string): string {
  return bindLastWords(line.replace(/\b(a|an|the|A|An|The) /g, `$1${noBreakSpace}`));
}
