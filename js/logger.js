// =====================
// Event Log
// =====================
export function log(msg, type) {
  const logDiv = document.getElementById('log');
  if (!logDiv) { console.warn('[log]', msg); return; }
  const entry = document.createElement('div');
  if (type) entry.className = 'log-' + type;
  const ts = new Date().toLocaleTimeString();
  entry.textContent = `[${ts}] ${msg}`;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
  console.log(msg);
}
