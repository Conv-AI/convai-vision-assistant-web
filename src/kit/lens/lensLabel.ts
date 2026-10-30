export type LensState =
  'ready' | 'listening' | 'held' | 'thinking' | 'speaking' | 'muted' | 'connecting' | 'offline';

export function lensLabel(name: string, state: LensState): string {
  switch (state) {
    case 'ready':
      return `${name}, ready`;
    case 'listening':
      return `${name}, listening`;
    case 'held':
      return `${name}, listening while you hold`;
    case 'thinking':
      return `${name}, thinking`;
    case 'speaking':
      return `${name}, speaking`;
    case 'muted':
      return `${name}, muted. You can still type.`;
    case 'connecting':
      return `Connecting to ${name}`;
    case 'offline':
      return `${name}, offline`;
  }
}
