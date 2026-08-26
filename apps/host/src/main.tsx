
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  // StrictMode double-mounts effects in dev, which would create two HostSessions
  // against one iframe. The session effect guards against that, but the host is
  // a debugging tool - a clean, single message log is worth more than the check.
  <App />,
);
