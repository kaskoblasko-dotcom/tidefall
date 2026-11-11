// Where is the game server?
// Default: the same origin that served this page (the Render Web Service serves both).
// If you host the frontend elsewhere (e.g. static hosting), set DEPLOYED_SERVER_URL to your
// Render URL, e.g. 'https://tidefall.onrender.com'. It can also be overridden at runtime with
// ?server=https://host in the URL, or in Settings > Server URL (saved in localStorage).
export const DEPLOYED_SERVER_URL = '';

export function serverBase() {
  let base = '';
  try { base = new URLSearchParams(location.search).get('server') || localStorage.getItem('tidefall.server') || ''; } catch { /* ignore */ }
  if (!base) base = DEPLOYED_SERVER_URL;
  if (!base) base = location.protocol === 'file:' ? 'http://localhost:3000' : location.origin;
  return base.replace(/\/+$/, '');
}
export const wsUrl = () => serverBase().replace(/^http/, 'ws') + '/ws';
export const httpUrl = (p) => serverBase() + p;
