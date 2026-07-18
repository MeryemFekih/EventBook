
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
