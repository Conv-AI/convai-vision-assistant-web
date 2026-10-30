export interface WindowSize {
  width: number;
  height: number;
}

export interface PictureWindows {
  /** True where the browser can open a floating window. */
  readonly supported: boolean;
  /**
   * Opens the floating window, dressed in the page's styles. Call it in the press itself: the
   * browser refuses it without one (`NotAllowedError`), and one tab has one window at a time.
   */
  open(size: WindowSize): Promise<Window>;
}

interface DocumentPictureInPicture {
  requestWindow(options?: WindowSize): Promise<Window>;
}

function pictureInPicture(view: Window): DocumentPictureInPicture | null {
  return (
    (view as Window & { documentPictureInPicture?: DocumentPictureInPicture })
      .documentPictureInPicture ?? null
  );
}

/**
 * Gives `to` what `from` is drawn with: its style sheets, the root's classes and inline style
 * (theme, contrast, motion, text size), its language and its title. A sheet goes over as its rules'
 * text, so the window is drawn styled from its first frame and asks the network for nothing but
 * fonts; one whose rules the page cannot read goes as a link to its whole address (the window's own
 * is about:blank).
 */
export function dressWindow(from: Document, to: Document): void {
  for (const node of from.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const sheet = (node as HTMLStyleElement | HTMLLinkElement).sheet;
    let rules: string | null = null;
    try {
      rules = sheet ? Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n') : null;
    } catch {
      // Another origin's sheet keeps its rules to itself.
    }
    if (rules !== null) {
      const style = to.createElement('style');
      style.textContent = rules;
      to.head.append(style);
      continue;
    }
    const copy = to.importNode(node, true) as HTMLElement;
    const href = node.getAttribute('href');
    if (href !== null) copy.setAttribute('href', new URL(href, from.baseURI).href);
    to.head.append(copy);
  }
  to.documentElement.className = from.documentElement.className;
  to.documentElement.lang = from.documentElement.lang;
  const style = from.documentElement.getAttribute('style');
  if (style === null) to.documentElement.removeAttribute('style');
  else to.documentElement.setAttribute('style', style);
  to.title = from.title;
}

/**
 * Keeps `to`'s root as `from`'s while the preferences change it (Settings applies them to the page's
 * root). Stop it with the returned function.
 */
export function mirrorRoot(from: Document, to: Document): () => void {
  const copy = () => {
    to.documentElement.className = from.documentElement.className;
    const style = from.documentElement.getAttribute('style');
    if (style === null) to.documentElement.removeAttribute('style');
    else to.documentElement.setAttribute('style', style);
  };
  const watch = new MutationObserver(copy);
  watch.observe(from.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  return () => {
    watch.disconnect();
  };
}

/** The browser's own floating windows, opened from `view`. */
export function browserPictureWindows(view: Window = window): PictureWindows {
  const api = pictureInPicture(view);
  return {
    supported: api !== null,
    open(size) {
      if (!api) return Promise.reject(new Error('This browser has no floating windows.'));
      // Asked before anything is awaited, so the press still counts.
      return api.requestWindow(size).then((opened) => {
        dressWindow(view.document, opened.document);
        return opened;
      });
    },
  };
}
