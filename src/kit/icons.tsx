const paths = {
  mic: 'M5.5 4a2.5 2.5 0 015 0v3.5a2.5 2.5 0 01-5 0z M3 7.5a5 5 0 0010 0M8 12.5v2',
  'mic-off': 'M5.5 4a2.5 2.5 0 015 0v3.5a2.5 2.5 0 01-5 0z M3 7.5a5 5 0 0010 0M8 12.5v2 M2 2l12 12',
  keyboard: 'M1.5 4h13v8.5h-13z M4 7h1M7 7h1M10 7h2M4.5 10h7',
  send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  stop: 'M4.5 4.5h7v7h-7z',
  captions: 'M1.5 3.5h13v9h-13z M4 7.5h3M9 7.5h3M4 10h5',
  transcript: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  history: 'M2.5 8a5.5 5.5 0 105.5-5.5A5.6 5.6 0 003.5 5 M3 2v3h3 M8 5v3l2 1.5',
  speaker: 'M2.5 6h2.5l3.5-3v10L5 10H2.5z M11 5.5a3.5 3.5 0 010 5 M12.8 3.8a6 6 0 010 8.4',
  person:
    'M8 2.5a2.7 2.7 0 110 5.4 2.7 2.7 0 010-5.4z M2.8 14c.6-2.7 2.7-4.2 5.2-4.2s4.6 1.5 5.2 4.2',
  settings:
    'M6.00 3.53L6.08 1.79L9.92 1.79L10.00 3.53A4.9 4.9 0 0 1 10.88 4.03L12.42 3.23L14.34 6.56L12.87 7.49A4.9 4.9 0 0 1 12.87 8.51L14.34 9.44L12.42 12.77L10.88 11.97A4.9 4.9 0 0 1 10.00 12.47L9.92 14.21L6.08 14.21L6.00 12.47A4.9 4.9 0 0 1 5.12 11.97L3.58 12.77L1.66 9.44L3.13 8.51A4.9 4.9 0 0 1 3.13 7.49L1.66 6.56L3.58 3.23L5.12 4.03A4.9 4.9 0 0 1 6.00 3.53z M10 8a2 2 0 11-4 0 2 2 0 014 0z',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',

  'close-small': 'M2 2l8 8M10 2l-8 8',
  back: 'M10 3L5 8l5 5',
  chevron: 'M6 3l5 5-5 5',
  'chevron-down': 'M3.5 6l4.5 4.5L12.5 6',
  check: 'M3 8.5l3 3 7-7',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  info: 'M8 1.8a6.2 6.2 0 110 12.4A6.2 6.2 0 018 1.8z M8 7.2v4M8 4.9h.01',
  warning: 'M8 2l6.5 11.5h-13z M8 6.5v3M8 11.6h.01',
  offline:
    'M1.8 6a9 9 0 0112.4 0 M4 8.4a6 6 0 018 0 M6.3 10.8a2.6 2.6 0 013.4 0 M8 13h.01 M2 2l12 12',
  retry: 'M13.5 8A5.5 5.5 0 113 5.5 M13.5 2.5v3h-3',
  undo: 'M5 6.5h5.5a3 3 0 010 6H7 M7.5 4l-2.5 2.5L7.5 9',
  copy: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
  external: 'M6 3H3v10h10v-3 M9 3h4v4M13 3L7 9',
  search: 'M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9z M10.5 10.5l3.5 3.5',
  expand: 'M9.5 2.5h4v4 M6.5 13.5h-4v-4 M13.5 2.5L9 7 M2.5 13.5L7 9',
  collapse: 'M13.5 6.5h-4v-4 M2.5 9.5h4v4 M9.5 6.5l4-4 M6.5 9.5l-4 4',
  view: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6a2 2 0 110 4 2 2 0 010-4z',
  'view-off': 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M2.5 13.5l11-11',
  /** A window with its right column: the pinned transcript (Hide transcript). */
  panel: 'M1.5 3h13v10h-13z M10 3v10',
  'arrow-down': 'M8 3v10M3.5 8.5L8 13l4.5-4.5',

  'text-size': 'M2 13l3.5-9h1L10 13 M3.2 10h5.6 M11 13l2-5 2 5 M11.7 11.4h2.6',
  cam: 'M1.5 4.5h9v7h-9z M10.5 7l4-2.5v7l-4-2.5',

  'source-camera':
    'M3.5 4h5a2 2 0 012 2v4a2 2 0 01-2 2h-5a2 2 0 01-2-2V6a2 2 0 012-2z M10.5 7l4-2v6l-4-2',
  /** The source set's screen, window and browser tab (a frame with its tab strip; README 364). */
  'source-screen': 'M1.5 2.5h13v9h-13z M5.5 14h5 M8 11.5V14',
  'source-window': 'M1.5 2.5h13v11h-13z M1.5 5.5h13',
  'source-tab': 'M1.5 2.5h13v11h-13z M1.5 5.5H4 M8.5 5.5h6 M4 5.5V2.5 M8.5 5.5V2.5',
  /** A region: the four corners of an area . */
  'source-region': 'M1.5 5.5v-3H5 M11 2.5h3.5v3 M14.5 10.5v3H11 M5 13.5H1.5v-3',
  /** An image file: a page with its corner folded . */
  'source-image': 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3',
  lock: 'M4 7h8v6.5H4z M5.5 7V5a2.5 2.5 0 015 0v2',
  hand: 'M5.5 8V3.5a1 1 0 012 0V7 M7.5 7V2.5a1 1 0 012 0V7 M9.5 7V3.5a1 1 0 012 0V9c0 3-1.8 4.5-4 4.5S4 12 3.2 10.5L2.3 8.8a1 1 0 011.6-1.1L5.5 9.5',
} as const;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  /** 16 by default; 14 in dense rows, 12 in a chip's mark, 20 on touch. */
  size?: 12 | 14 | 16 | 20;
  className?: string;
}

/** Glyphs drawn in a box of their own, with their own stroke; the rest are 16 at 1.5. */
const ownBox: Partial<Record<IconName, { box: number; stroke: number }>> = {
  more: { box: 16, stroke: 2 },
  'close-small': { box: 12, stroke: 1.6 },
};

/** A shared icon. It is decoration: the control that holds it carries the name. */
export function Icon({ name, size = 16, className }: IconProps) {
  const { box, stroke } = ownBox[name] ?? { box: 16, stroke: 1.5 };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${String(box)} ${String(box)}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
