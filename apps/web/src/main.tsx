import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SetupNotice } from './components/SetupNotice';
import { readConfig } from './env';
import './index.css';
import { createServices, ServicesContext } from './services';
import { parseSharedLink } from './share';

const config = readConfig();
const services = config ? createServices(config) : null;

// The Android share sheet opens the installed app at /share?title=…&text=…&url=…
const sharing = location.pathname === '/share';
const share = sharing ? parseSharedLink(new URLSearchParams(location.search)) : null;
if (sharing) history.replaceState(null, '', '/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {services ? (
      <ServicesContext value={services}>
        <App share={share} />
      </ServicesContext>
    ) : (
      <SetupNotice />
    )}
  </StrictMode>,
);
