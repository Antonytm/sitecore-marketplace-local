import { createRoot } from 'react-dom/client';
import { installTap } from './tap';
import { App } from './App';
import './styles.css';

// Before anything else imports the SDK: the handshake is the most interesting
// exchange in the transcript and it happens on init.
installTap();

createRoot(document.getElementById('root')!).render(<App />);
