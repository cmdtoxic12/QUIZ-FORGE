const TOKEN_KEY = "qf_token";
const USER_KEY = "qf_user";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requireLogin() {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return null;
  }

  try {
    const res = await fetch("/api/auth/me", {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Session expired");
    const data = await res.json();
    setAuth(token, data.user);
    return data.user;
  } catch {
    clearAuth();
    window.location.href = "/login";
    return null;
  }
}

function logout() {
  if (window.firebaseAuth) {
    window.firebaseAuth.signOut().catch(() => {});
  }
  clearAuth();
  window.location.href = "/login";
}

async function exchangeFirebaseToken(idToken) {
  const res = await fetch("/api/auth/firebase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Auth failed");
  setAuth(data.token, data.user);
  return data.user;
}

window.Auth = {
  getToken,
  getUser,
  setAuth,
  clearAuth,
  authHeaders,
  requireLogin,
  logout,
  exchangeFirebaseToken,
};