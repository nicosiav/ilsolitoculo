/* Client minimo per Supabase (autenticazione, dati, storage).
 * Nessuna libreria esterna: sono le stesse chiamate HTTP che farebbe supabase-js. */
(function (root) {
  'use strict';

  const KEY = 'schiera-sessione:v1';
  const cfg = () => root.SCHIERA_CONFIG || {};
  const base = () => String(cfg().url || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const anon = () => cfg().anonKey || '';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { session = null; }

  function store(s) {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) { /* ok */ }
  }

  class SbError extends Error {
    constructor(message, code, status) { super(message); this.code = code; this.status = status; }
  }

  const MESSAGES = {
    invalid_credentials: 'Email o password non corretti.',
    email_not_confirmed: 'Account non ancora confermato: chiedi all’amministratore.',
    over_request_rate_limit: 'Troppi tentativi: riprova tra qualche minuto.',
    P0001: 'Questo account non è collegato a nessuna squadra: scrivi all’amministratore.',
    P0002: 'La giornata è finita: la formazione non si può più cambiare.',
    P0004: 'Puoi schierare solo giocatori della tua rosa.',
    P0005: 'Serve un account da amministratore per questa operazione.',
    '42501': 'Non hai i permessi per questa operazione.'
  };

  function fail(status, body) {
    const code = body && (body.error_code || body.code || body.error) || String(status);
    const msg = MESSAGES[code] ||
      (body && (body.message || body.msg || body.errore || body.error_description || body.error)) ||
      ('Errore di rete (' + status + ')');
    return new SbError(msg, code, status);
  }

  async function call(path, opts = {}) {
    const res = await fetch(base() + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ apikey: anon(), 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) throw fail(res.status, data);
    return data;
  }

  async function refresh() {
    if (!session || !session.refresh_token) throw new SbError('Sessione scaduta: entra di nuovo.', 'no_session', 401);
    const d = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    store(normalize(d));
    return session;
  }

  function normalize(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user || (session && session.user) || null
    };
  }

  async function authed(path, opts = {}) {
    if (!session) throw new SbError('Devi entrare con il tuo account.', 'no_session', 401);
    if (session.expires_at && session.expires_at - 60 < Math.floor(Date.now() / 1000)) await refresh();
    const withToken = () => Object.assign({ Authorization: 'Bearer ' + session.access_token }, opts.headers || {});
    try {
      return await call(path, Object.assign({}, opts, { headers: withToken() }));
    } catch (e) {
      if (e.status === 401) { await refresh(); return call(path, Object.assign({}, opts, { headers: withToken() })); }
      throw e;
    }
  }

  const api = {
    SbError,
    configured: () => !!(base() && anon()),
    session: () => session,
    user: () => session && session.user,

    async signIn(email, password) {
      const d = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password } });
      store(normalize(d));
      return session;
    },

    async signOut() {
      try { if (session) await authed('/auth/v1/logout', { method: 'POST', body: {} }); } catch (e) { /* esco comunque */ }
      store(null);
    },

    // Invia l'email per reimpostare la password
    recover(email, redirectTo) {
      const q = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
      return call('/auth/v1/recover' + q, { method: 'POST', body: { email: String(email).trim() } });
    },

    // Dopo il link ricevuto per email: la sessione arriva nel fragment dell'URL
    adoptFromHash() {
      const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      if (!h.get('access_token')) return null;
      store({
        access_token: h.get('access_token'),
        refresh_token: h.get('refresh_token'),
        expires_at: Math.floor(Date.now() / 1000) + (+h.get('expires_in') || 3600),
        user: null
      });
      const type = h.get('type');
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ok */ }
      return { type };
    },

    async me() {
      const u = await authed('/auth/v1/user');
      if (session) store(Object.assign({}, session, { user: u }));
      return u;
    },

    setPassword(password) {
      return authed('/auth/v1/user', { method: 'PUT', body: { password } });
    },

    select(table, query) {
      return authed('/rest/v1/' + table + (query ? '?' + query : ''));
    },

    rpc(fn, args) {
      return authed('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} });
    },

    // Funzioni sul server (Edge Functions), es. l'aggiornamento del calendario
    fn(name, query, body) {
      return authed('/functions/v1/' + name + (query ? '?' + query : ''), { method: 'POST', body: body || {} });
    },

    async download(bucket, path) {
      if (!session) throw new SbError('Devi entrare con il tuo account.', 'no_session', 401);
      if (session.expires_at && session.expires_at - 60 < Math.floor(Date.now() / 1000)) await refresh();
      const res = await fetch(base() + '/storage/v1/object/' + bucket + '/' + path, {
        headers: { apikey: anon(), Authorization: 'Bearer ' + session.access_token }
      });
      if (!res.ok) throw fail(res.status, await res.json().catch(() => null));
      return new Uint8Array(await res.arrayBuffer());
    },

    async upload(bucket, path, blob, contentType) {
      if (!session) throw new SbError('Devi entrare con il tuo account.', 'no_session', 401);
      if (session.expires_at && session.expires_at - 60 < Math.floor(Date.now() / 1000)) await refresh();
      const res = await fetch(base() + '/storage/v1/object/' + bucket + '/' + path, {
        method: 'POST',
        headers: {
          apikey: anon(),
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': contentType || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: blob
      });
      if (!res.ok) throw fail(res.status, await res.json().catch(() => null));
      return true;
    }
  };

  root.SB = api;
})(typeof window !== 'undefined' ? window : globalThis);
