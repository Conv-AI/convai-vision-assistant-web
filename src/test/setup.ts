import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lays nothing out, so it has nothing to scroll: a control that brings a row into view (a
// select's menu, a row Settings points out) or scrolls a page back to its top does nothing here.
// The server's tests run without a DOM at all.
if (typeof Element !== 'undefined') {
  for (const name of ['scrollIntoView', 'scrollTo']) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: () => undefined, writable: true });
    }
  }
}

afterEach(() => {
  cleanup();
});
