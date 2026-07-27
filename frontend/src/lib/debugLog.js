export function debugLog(component, message, data) {
  const timestamp = new Date().toISOString().split('T')[1];
  const logMsg = `[${timestamp}] [${component}] ${message}`;
  console.log(logMsg, data || '');
  // Also send to localStorage for persistence
  try {
    const existing = JSON.parse(localStorage.getItem('debug_log') || '[]');
    existing.push({ timestamp, component, message, data });
    localStorage.setItem('debug_log', JSON.stringify(existing.slice(-50)));
  } catch (e) {
    // ignore
  }
}

export function getDebugLog() {
  try {
    return JSON.parse(localStorage.getItem('debug_log') || '[]');
  } catch (e) {
    return [];
  }
}

export function clearDebugLog() {
  localStorage.removeItem('debug_log');
}
