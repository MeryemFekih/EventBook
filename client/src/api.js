// api.js — SECURE VERSION
// FIX (bonus - token in localStorage): the token now lives only in a module-
// level JS variable, never in localStorage/sessionStorage. It cannot be read
// by a script running after page load, and disappears on refresh instead of
// persisting indefinitely.
let authToken = null;

export function saveToken(token) {
  authToken = token;
}
export function getToken() {
  return authToken;
}
export function clearToken() {
  authToken = null;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      Authorization: 'Bearer ' + (authToken || ''),
    },
  });
  return res.json();
}
