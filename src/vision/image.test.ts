import { describe, expect, it } from 'vitest';
import {
  checkImage,
  chooseImage,
  hasImageKind,
  imageMaxBytes,
  imageSignature,
  pasteTakes,
  shownImageName,
} from './image';
import { imageRefusedNotice, visionKeys } from './notices';

const file = (name: string, size = 1000, type = '') => ({ name, size, type });

describe('which files are shared as an image (K5b, A20; Unity ImageFileRule)', () => {
  it.each(['mug.jpg', 'mug.JPG', 'mug.jpeg', 'Mug.Jpeg', 'scan.png', 'SCAN.PNG', 'a.b.png'])(
    'takes %s by its name',
    (name) => {
      expect(checkImage(file(name))).toBeNull();
    },
  );

  it.each(['mug.gif', 'mug.webp', 'mug.heic', 'notes.pdf', 'png', '.png', 'mug.png.txt', ''])(
    'refuses %s for its kind',
    (name) => {
      expect(checkImage(file(name))).toBe('not-image');
    },
  );

  it('takes a file without an image name that the browser says is a PNG or a JPEG', () => {
    expect(hasImageKind(file('picture', 10, 'image/png'))).toBe(true);
    expect(hasImageKind(file('picture', 10, 'IMAGE/JPEG'))).toBe(true);
    expect(hasImageKind(file('picture', 10, 'image/webp'))).toBe(false);
  });

  it('takes 20 MB and refuses a byte more', () => {
    expect(checkImage(file('big.png', imageMaxBytes))).toBeNull();
    expect(checkImage(file('big.png', imageMaxBytes + 1))).toBe('too-large');
    expect(imageMaxBytes).toBe(20 * 1024 * 1024);
  });

  it('names the kind first: a large file of the wrong kind is refused for its kind', () => {
    expect(checkImage(file('film.mov', imageMaxBytes * 2))).toBe('not-image');
  });

  it('refuses a file the platform could not measure as unreadable', () => {
    expect(checkImage(file('gone.png', -1))).toBe('unreadable');
  });

  it('of several files, shares the first image; without one, the first file', () => {
    expect(chooseImage([file('a.pdf'), file('b.png'), file('c.jpg')])?.name).toBe('b.png');
    expect(chooseImage([file('a.pdf'), file('b.txt')])?.name).toBe('a.pdf');
    expect(chooseImage([])).toBeNull();
  });
});

describe('what a pasted picture is called (answers 2026-10-14b Q15)', () => {
  it.each(['image.png', 'IMAGE.PNG', 'image.jpg', 'image.jpeg', 'image.webp', 'image.gif'])(
    'calls a paste the browser named %s "Pasted image"',
    (name) => {
      expect(shownImageName(name, true)).toBe('Pasted image');
    },
  );

  it.each(['image (2).png', 'my image.png', 'mug.jpg', 'images.png'])(
    'keeps a copied file’s own name, %s',
    (name) => {
      expect(shownImageName(name, true)).toBe(name);
    },
  );

  it('keeps the name of a file chosen or dropped, even "image.png"', () => {
    expect(shownImageName('image.png', false)).toBe('image.png');
  });
});

describe('whether a paste is taken', () => {
  it('takes a file wherever the focus is, the Type field’s too', () => {
    expect(pasteTakes({ files: 1, hasText: false, inTextField: false })).toBe(true);
    expect(pasteTakes({ files: 1, hasText: false, inTextField: true })).toBe(true);
  });

  it('leaves a paste of text alone, and a focused field the text of a paste that has both', () => {
    expect(pasteTakes({ files: 0, hasText: true, inTextField: true })).toBe(false);
    expect(pasteTakes({ files: 0, hasText: true, inTextField: false })).toBe(false);
    expect(pasteTakes({ files: 1, hasText: true, inTextField: true })).toBe(false);
  });

  it('takes the file of a paste with text when no text field has the focus', () => {
    expect(pasteTakes({ files: 1, hasText: true, inTextField: false })).toBe(true);
  });
});

describe('what a file’s first bytes say it is', () => {
  it('knows a PNG and a JPEG, and nothing else', () => {
    expect(imageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(imageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(imageSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(imageSignature(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(imageSignature(new Uint8Array([]))).toBeNull();
  });
});

describe('the refusal toasts (K5b)', () => {
  it('says one cause each, with the plain dot, for 4 s', () => {
    expect(imageRefusedNotice('not-image')).toMatchObject({
      level: 'status',

      title: 'PNG and JPG only',
      seconds: 4,
    });
    expect(imageRefusedNotice('too-large').title).toBe('That image is over 20 MB');
    expect(imageRefusedNotice('unreadable').title).toBe('That file couldn’t be opened');
    expect(imageRefusedNotice('not-image').mark).toBeUndefined();
    expect(imageRefusedNotice('not-image').brief).toBeUndefined();
  });

  it('has a key for each cause, so a second refusal of another cause is not dropped', () => {
    const keys = (['not-image', 'too-large', 'unreadable'] as const).map(
      (refusal) => imageRefusedNotice(refusal).key,
    );
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(visionKeys.imageRefused['not-image']);
  });
});
