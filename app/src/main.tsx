import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initEntra } from './auth/entra';
import './styles.css';

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// Finish any sign-in redirect before rendering, so its response in the URL is consumed first.
initEntra()
  .catch((e) => console.warn(e))
  .finally(render);
