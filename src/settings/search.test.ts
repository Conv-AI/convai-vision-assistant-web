import { describe, expect, it } from 'vitest';
import { countRows, findRows, isQuery, resultLabel, type SearchableRow } from './search';

interface Row extends SearchableRow {
  shown?: boolean;
}
interface Group {
  label: string;
  rows: Row[];
}
interface Section {
  title: string;
  groups: Group[];
}

const registry: Section[] = [
  {
    title: 'Talking',
    groups: [{ label: '', rows: [{ label: 'Café mode', description: 'For noisy rooms' }] }],
  },
  {
    title: 'Audio',
    groups: [
      {
        label: 'Microphone',
        rows: [
          { label: 'Input device', keywords: 'mic' },
          { label: 'Echo cancellation' },
          { label: 'Test your microphone', description: 'Records 3 seconds, then plays them back' },
        ],
      },
      { label: 'Speaker', rows: [{ label: 'Kira’s volume' }] },
    ],
  },
];

function found(query: string, sections: Section[] = registry): string[] {
  return findRows(sections, query).map(
    (g) =>
      `${resultLabel(g.section.title, g.group.label)}: ${g.rows.map((r) => r.label).join(', ')}`,
  );
}

describe('the search of Settings', () => {
  it('finds rows by label, description and declared words, in the sidebar’s order', () => {
    expect(found('mic')).toEqual(['Audio › Microphone: Input device, Test your microphone']);
    expect(found('records')).toEqual(['Audio › Microphone: Test your microphone']);
    expect(found('room')).toEqual(['Talking: Café mode']);
  });

  it('puts groups whose rows are named by the words first, then described, then declared', () => {
    // Declared words come first in this sidebar: only the tiers put the described group before them.
    const sections: Section[] = [
      {
        title: 'Shortcuts',
        groups: [{ label: 'Keys', rows: [{ label: 'Pick', keywords: 'camera' }] }],
      },
      {
        title: 'Accessibility',
        groups: [
          { label: 'Reading', rows: [{ label: 'Backing', description: 'Over the camera' }] },
        ],
      },
      {
        title: 'Vision',
        groups: [
          {
            label: 'Sources',
            rows: [
              { label: 'Start with', description: 'The camera or nothing' },
              { label: 'Camera' },
            ],
          },
        ],
      },
      { title: 'Privacy', groups: [{ label: 'Choices', rows: [{ label: 'Camera access' }] }] },
    ];
    expect(found('camera', sections)).toEqual([
      'Vision › Sources: Start with, Camera',
      'Privacy › Choices: Camera access',
      'Accessibility › Reading: Backing',
      'Shortcuts › Keys: Pick',
    ]);
    // A row that every word names by its label, one by its description: the description's tier.
    expect(found('pick camera', sections)).toEqual(['Shortcuts › Keys: Pick']);
    expect(found('camera over', sections)).toEqual(['Accessibility › Reading: Backing']);
  });

  it('counts section and group names only when no row is found by its own words', () => {
    expect(found('speaker')).toEqual(['Audio › Speaker: Kira’s volume']);
    expect(countRows(findRows(registry, 'audio'))).toBe(4);
    expect(found('microphone echo')).toEqual(['Audio › Microphone: Echo cancellation']);
    expect(found('audio zebra')).toEqual([]);
  });

  it('ignores case and accents and matches words from their start', () => {
    expect(found('CAFE')).toEqual(['Talking: Café mode']);
    expect(found('café')).toHaveLength(1);
    expect(found('phone')).toEqual([]);
    expect(found('kiras vol')).toEqual(['Audio › Speaker: Kira’s volume']);
    expect(found('kira echo')).toEqual([]);
    expect(found('test  microphone ')).toEqual(['Audio › Microphone: Test your microphone']);
  });

  it('finds letters with no accent to drop by what is typed for them', () => {
    const sections: Section[] = [
      {
        title: 'Ses',
        groups: [
          {
            label: 'Geräte',
            rows: [
              { label: 'Lautstärke groß' },
              { label: 'Işık açık' },
              { label: 'Lydstyrke høj' },
              { label: 'Głośność' },
            ],
          },
        ],
      },
    ];
    const labels = (query: string) =>
      findRows(sections, query).flatMap((g) => g.rows.map((r) => r.label));
    expect(labels('gross')).toEqual(['Lautstärke groß']);
    expect(labels('GROSS')).toEqual(['Lautstärke groß']);
    expect(labels('isik acik')).toEqual(['Işık açık']);
    expect(labels('IŞIK')).toEqual(['Işık açık']);
    expect(labels('hoj')).toEqual(['Lydstyrke høj']);
    expect(labels('glosnosc')).toEqual(['Głośność']);
  });

  it('searches nothing before the second character', () => {
    expect(isQuery('m')).toBe(false);
    expect(isQuery(' m ')).toBe(false);
    expect(isQuery('mi')).toBe(true);
    expect(found('m')).toEqual([]);
    expect(found('')).toEqual([]);
    expect(found('lighting')).toEqual([]);
    expect(countRows(findRows(registry, 'mic'))).toBe(2);
  });

  it('cuts a result group’s name at its first comma', () => {
    expect(resultLabel('Privacy', 'Sent to Convai, only during a conversation')).toBe(
      'Privacy › Sent to Convai',
    );
    expect(resultLabel('Privacy', 'Your choices')).toBe('Privacy › Your choices');
    expect(resultLabel('Privacy', '')).toBe('Privacy');
    expect(resultLabel('Privacy', ', odd')).toBe('Privacy › , odd');
  });
});
