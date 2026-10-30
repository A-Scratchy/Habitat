import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initEntra } from './auth/entra';
import { captureJoinLink } from './data/join';
import { watchOrientation } from './orientation';
import './styles.css';

watchOrientation();
// Before sign-in handling, so a join link's code is kept and the address is tidied first.
captureJoinLink();

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
