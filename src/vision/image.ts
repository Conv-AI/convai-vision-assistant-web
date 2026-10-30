/** The largest image file that is shared: 20 MB. */
export const imageMaxBytes = 20 * 1024 * 1024;

export type ImageRefusal = 'not-image' | 'too-large' | 'unreadable';

export const imageAccept = '.png,.jpg,.jpeg,image/png,image/jpeg';

/** What a file is, as far as this needs to know: a `File` fits. */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

const imageNames = /.\.(png|jpe?g)$/i;
const imageTypes = new Set(['image/png', 'image/jpeg']);

/**
 * Whether a file is one this app decodes: a PNG or JPEG by its name (whatever the case of its
 * extension), or by the kind the browser gives it (a picture dragged out of a page may have no
 * extension).
 */
export function hasImageKind(file: FileLike): boolean {
  return imageNames.test(file.name) || imageTypes.has(file.type.toLowerCase());
}

/** Why a file would be refused, or null when it may be shared. */
export function checkImage(file: FileLike): ImageRefusal | null {
  if (!hasImageKind(file)) return 'not-image';
  if (file.size < 0) return 'unreadable';
  return file.size > imageMaxBytes ? 'too-large' : null;
}

/**
 * Of several files given together, the one to share: the first that is an image, since one image is
 * shared at a time; without any, the first file, which is then refused for its kind. Null for none.
 */
export function chooseImage<T extends FileLike>(files: readonly T[]): T | null {
  return files.find(hasImageKind) ?? files[0] ?? null;
}

/**
 * The names browsers give a picture pasted on a page, which has no name of its own: Chrome, Edge and
 * Firefox say "image.png", and a picture of another kind is named for its kind the same way.
 */
const browserPictureNames = new Set([
  'image.png',
  'image.jpg',
  'image.jpeg',
  'image.webp',
  'image.gif',
]);

export const pastedImageName = 'Pasted image';

export function shownImageName(name: string, pasted: boolean): string {
  return pasted && browserPictureNames.has(name.toLowerCase()) ? pastedImageName : name;
}

export interface PasteInput {
  files: number;
  /** Whether it carries plain text too. */
  hasText: boolean;
  /** Whether a text field has the focus. */
  inTextField: boolean;
}

export function pasteTakes({ files, hasText, inTextField }: PasteInput): boolean {
  return files > 0 && !(inTextField && hasText);
}

/** The JPEG and PNG signatures: the first bytes say what a file is, whatever its name. */
export function imageSignature(head: Uint8Array): 'png' | 'jpeg' | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  return null;
}

/** The error an image's decoding rejects with: its refusal says why. */
export class ImageError extends Error {
  readonly refusal: ImageRefusal;

  constructor(refusal: ImageRefusal) {
    super(`The image could not be shared (${refusal}).`);
    this.name = 'ImageError';
    this.refusal = refusal;
  }
}
