// api.js — VULNERABLE VERSION
// VULN (bonus): JWT stored in localStorage -> readable by any injected script.
export function saveToken(token) {
  localStorage.setItem('eb_token', token);
}
export function getToken() {
  return localStorage.getItem('eb_token');
}
export function clearToken() {
  localStorage.removeItem('eb_token');
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      Authorization: 'Bearer ' + (getToken() || ''),
    },
  });
  return res.json();
}
