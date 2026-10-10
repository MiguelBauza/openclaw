// Minimal Supabase client (Auth email-code login + PostgREST) built on fetch, so
// the installed PWA needs no external library and keeps working offline.
// Exposes `globalThis.SubCloud`. Project settings come from config.js
// (`globalThis.SUBS_SUPABASE`) or from Ajustes, stored in localStorage.
(function (root) {
  "use strict";

  const CONFIG_KEY = "subs.supabase.config.v1";
  const SESSION_KEY = "subs.supabase.session.v1";
  const TABLE = "subscriptions";

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (value == null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      /* storage unavailable */
    }
  }

  function cloudError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function getConfig() {
    const saved = read(CONFIG_KEY);
    const builtIn = root.SUBS_SUPABASE || {};
    const cfg = saved && saved.url ? saved : builtIn;
    return cfg.url && cfg.anonKey
      ? { url: cfg.url.replace(/\/+$/, ""), anonKey: cfg.anonKey }
      : null;
  }

  function setConfig(url, anonKey) {
    const clean = String(url || "")
      .trim()
      .replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+$/i.test(clean)) {
      throw cloudError("La URL debe ser como https://tu-proyecto.supabase.co");
    }
    if (!String(anonKey || "").trim()) {
      throw cloudError("Falta la clave pública (anon / publishable)");
    }
    write(CONFIG_KEY, { url: clean, anonKey: String(anonKey).trim() });
    write(SESSION_KEY, null);
  }

  function clearConfig() {
    write(CONFIG_KEY, null);
    write(SESSION_KEY, null);
  }

  const getSession = () => read(SESSION_KEY);
  const isConfigured = () => Boolean(getConfig());
  const isSignedIn = () => Boolean(getConfig() && getSession());
  const userEmail = () => (getSession() && getSession().user && getSession().user.email) || "";

  function storeSession(data) {
    const expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    write(SESSION_KEY, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      user: { id: data.user.id, email: data.user.email },
    });
  }

  async function raw(path, opts, token) {
    const cfg = getConfig();
    if (!cfg) {
      throw cloudError("Supabase no está configurado");
    }
    const headers = Object.assign(
      { apikey: cfg.anonKey, "Content-Type": "application/json" },
      opts.headers,
    );
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(cfg.url + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        (data && (data.msg || data.message || data.error_description || data.error)) ||
        res.statusText;
      throw cloudError(String(msg), res.status);
    }
    return data;
  }

  async function refresh() {
    const session = getSession();
    if (!session) {
      throw cloudError("Sesión cerrada", 401);
    }
    try {
      const data = await raw("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token },
      });
      storeSession(data);
    } catch (err) {
      // A rejected refresh token means the session is gone; network errors keep it.
      if (err.status === 400 || err.status === 401) {
        write(SESSION_KEY, null);
      }
      throw err;
    }
  }

  // Authenticated request: refreshes the token shortly before it expires and once on 401.
  async function authed(path, opts) {
    let session = getSession();
    if (!session) {
      throw cloudError("Sesión cerrada", 401);
    }
    if (session.expires_at - 60 < Date.now() / 1000) {
      await refresh();
      session = getSession();
    }
    try {
      return await raw(path, opts, session.access_token);
    } catch (err) {
      if (err.status !== 401) {
        throw err;
      }
      await refresh();
      return raw(path, opts, getSession().access_token);
    }
  }

  async function sendCode(email) {
    await raw("/auth/v1/otp", { method: "POST", body: { email, create_user: true } });
  }

  // New accounts get the "confirm signup" email, existing ones the "magic link" one;
  // try the token types GoTrue accepts for each.
  async function verifyCode(email, token) {
    let lastErr = null;
    for (const type of ["email", "signup", "magiclink"]) {
      try {
        const data = await raw("/auth/v1/verify", { method: "POST", body: { type, email, token } });
        if (data && data.access_token) {
          storeSession(data);
          return;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || cloudError("Código no válido");
  }

  async function signOut() {
    const session = getSession();
    write(SESSION_KEY, null);
    if (session) {
      raw("/auth/v1/logout", { method: "POST" }, session.access_token).catch(() => {});
    }
  }

  async function fetchRows() {
    return authed(`/rest/v1/${TABLE}?select=id,data,updated_at`, {});
  }

  async function upsertRows(items) {
    if (!items.length) {
      return;
    }
    const userId = getSession().user.id;
    const now = new Date().toISOString();
    await authed(`/rest/v1/${TABLE}?on_conflict=user_id,id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: items.map((it) => ({ user_id: userId, id: it.id, data: it.data, updated_at: now })),
    });
  }

  async function deleteRow(id) {
    await authed(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  root.SubCloud = {
    getConfig,
    setConfig,
    clearConfig,
    isConfigured,
    isSignedIn,
    userEmail,
    sendCode,
    verifyCode,
    signOut,
    fetchRows,
    upsertRows,
    deleteRow,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
