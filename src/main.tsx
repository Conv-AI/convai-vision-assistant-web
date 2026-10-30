import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './kit/index.css';
import './app/tokens.css';
import './app/app.css';
import './app/characters.css';
import './app/firstRun.css';
import './app/settings.css';
import './app/compact.css';
import './app/quick.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The page has no #root element to render into.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
