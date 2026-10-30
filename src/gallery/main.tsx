import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../kit/index.css';
import './gallery.css';
import { Gallery } from './Gallery';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The page has no #root element to render into.');
}

createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
