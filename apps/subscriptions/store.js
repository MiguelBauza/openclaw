// Persistence for the subscription manager. Always keeps a localStorage copy, plus:
// - inside a Claude artifact viewer: syncs to the viewer's private `db` subtree;
// - elsewhere (installed PWA), when Supabase is configured: queues every change and
//   syncs it to the user's rows (see supabase.js), so data follows the account.
// Exposes `globalThis.SubStore`.
(function (root) {
  "use strict";

  const SUBS_KEY = "subs.v1";
  const SETTINGS_KEY = "subs.settings.v1";
  const SYNCED_KEY = "subs.synced.v1";
  const PENDING_KEY = "subs.cloud.pending.v1";
  const MERGED_KEY = "subs.cloud.merged.v1";
  const SETTINGS_ROW = "__settings";

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  const hasClaude = () => Boolean(root.claude && typeof root.claude.use === "function");

  function createStore(handlers) {
    const onChange = handlers.onChange || (() => {});
    const onStatus = handlers.onStatus || (() => {});
    const onCloud = handlers.onCloud || (() => {});
    const state = {
      subs: load(SUBS_KEY, []),
      settings: Object.assign({ currency: "EUR" }, load(SETTINGS_KEY, {})),
    };
    let remote = null;
    let downloads = null;

    // ---- Supabase sync (installed app) ----
    const cloud = () =>
      !hasClaude() && root.SubCloud && root.SubCloud.isConfigured() ? root.SubCloud : null;
    let pending = load(PENDING_KEY, []);
    const sync = { running: false, again: false, timer: null, last: null, error: "" };

    // Latest op per id wins; ops are flushed in order on the next sync.
    function queue(op) {
      if (!cloud()) {
        return;
      }
      pending = pending.filter((p) => p.id !== op.id);
      pending.push(op);
      save(PENDING_KEY, pending);
      clearTimeout(sync.timer);
      sync.timer = setTimeout(() => syncCloud(), 400);
    }

    async function syncCloud() {
      const c = cloud();
      if (!c || !c.isSignedIn()) {
        onCloud();
        return;
      }
      if (sync.running) {
        sync.again = true;
        return;
      }
      sync.running = true;
      onCloud();
      try {
        while (pending.length) {
          const batch = pending.slice();
          await c.upsertRows(batch.filter((p) => p.op === "upsert"));
          for (const op of batch.filter((p) => p.op === "delete")) {
            await c.deleteRow(op.id);
          }
          // Keep ops queued while this batch was in flight (they are new objects).
          pending = pending.filter((p) => !batch.includes(p));
          save(PENDING_KEY, pending);
        }
        const rows = await c.fetchRows();
        // First sync of this account on this device: upload local items it lacks.
        const email = c.userEmail();
        if (load(MERGED_KEY, "") !== email) {
          const ids = new Set(rows.map((r) => r.id));
          const missing = state.subs
            .filter((s) => !ids.has(s.id))
            .map((s) => ({ id: s.id, data: s }));
          if (!ids.has(SETTINGS_ROW)) {
            missing.push({ id: SETTINGS_ROW, data: state.settings });
          }
          await c.upsertRows(missing);
          rows.push(...missing);
          save(MERGED_KEY, email);
        }
        if (pending.length) {
          sync.again = true; // edited during the fetch; pull again after flushing
        } else {
          state.subs = rows.filter((r) => r.id !== SETTINGS_ROW).map((r) => r.data);
          const st = rows.find((r) => r.id === SETTINGS_ROW);
          if (st && st.data && st.data.currency) {
            state.settings.currency = st.data.currency;
          }
          persistLocal();
          onChange();
        }
        sync.last = new Date();
        sync.error = "";
        onStatus("");
      } catch (err) {
        sync.error = err && err.message ? err.message : "Error de red";
        onStatus(
          c.isSignedIn()
            ? "Sin conexión con la nube: los cambios se subirán cuando vuelva la red."
            : "Tu sesión en la nube ha caducado. Vuelve a entrar en Ajustes.",
        );
      } finally {
        sync.running = false;
        onCloud();
        if (sync.again) {
          sync.again = false;
          clearTimeout(sync.timer);
          sync.timer = setTimeout(() => syncCloud(), 400);
        }
      }
    }

    function cloudState() {
      const c = root.SubCloud;
      return {
        available: !hasClaude() && Boolean(c),
        configured: Boolean(cloud()),
        signedIn: Boolean(cloud() && c.isSignedIn()),
        email: c ? c.userEmail() : "",
        syncing: sync.running,
        last: sync.last,
        error: sync.error,
        pending: pending.length,
      };
    }

    function mode() {
      if (remote) {
        return "claude";
      }
      return cloud() && root.SubCloud.isSignedIn() ? "cloud" : "local";
    }

    const persistLocal = () => {
      save(SUBS_KEY, state.subs);
      save(SETTINGS_KEY, state.settings);
    };
    const fail = () =>
      onStatus("No se pudo guardar en tu cuenta; los cambios quedan en este dispositivo.");
    const subDoc = (id) => remote.doc(`sub_${id}`);
    const pushSub = (sub) =>
      subDoc(sub.id)
        .set(Object.assign({ kind: "sub" }, sub))
        .catch(fail);

    function saveSub(sub) {
      const idx = state.subs.findIndex((s) => s.id === sub.id);
      if (idx >= 0) {
        state.subs[idx] = sub;
      } else {
        state.subs.push(sub);
      }
      persistLocal();
      if (remote) {
        pushSub(sub);
      }
      queue({ op: "upsert", id: sub.id, data: sub });
      return idx < 0;
    }

    function deleteSub(id) {
      state.subs = state.subs.filter((s) => s.id !== id);
      persistLocal();
      if (remote) {
        subDoc(id).delete().catch(fail);
      }
      queue({ op: "delete", id });
    }

    async function replaceAll(list) {
      const previous = state.subs;
      state.subs = list.slice();
      persistLocal();
      const keepIds = new Set(list.map((s) => s.id));
      previous.filter((s) => !keepIds.has(s.id)).forEach((s) => queue({ op: "delete", id: s.id }));
      list.forEach((s) => queue({ op: "upsert", id: s.id, data: s }));
      if (!remote) {
        return;
      }
      const keep = new Set(list.map((s) => s.id));
      for (const old of previous) {
        if (!keep.has(old.id)) {
          await subDoc(old.id).delete().catch(fail);
        }
      }
      for (const sub of list) {
        await pushSub(sub);
      }
    }

    function saveSettings(patch) {
      Object.assign(state.settings, patch);
      persistLocal();
      queue({ op: "upsert", id: SETTINGS_ROW, data: Object.assign({}, state.settings) });
      if (remote) {
        remote
          .doc("settings")
          .set(Object.assign({ kind: "settings" }, state.settings))
          .catch(fail);
      }
    }

    async function connect() {
      if (!hasClaude()) {
        // Installed app: sync now, when the app comes back to the foreground,
        // when the network returns, and every minute while visible.
        syncCloud();
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) {
            syncCloud();
          }
        });
        window.addEventListener("online", () => syncCloud());
        setInterval(() => {
          if (!document.hidden) {
            syncCloud();
          }
        }, 60_000);
        return;
      }
      root.claude.use("downloads").then((d) => {
        downloads = d;
        onChange();
      });
      const [db, user] = await Promise.all([root.claude.use("db"), root.claude.use("user")]);
      if (!db || !user) {
        onStatus(
          "Inicia sesión en Claude para guardar en tu cuenta. Ahora se guardan en este dispositivo.",
        );
        return;
      }
      remote = db.collection(`data/users/${await user.id()}`);
      const localCopy = state.subs.slice();
      let first = true;
      remote.onSnapshot(
        (snap) => {
          // First visit with an empty account: upload what this device already had.
          if (first && snap.empty && localCopy.length && !load(SYNCED_KEY, false)) {
            first = false;
            replaceAll(localCopy);
            saveSettings({});
            return;
          }
          first = false;
          save(SYNCED_KEY, true);
          const docs = snap.docs.map((d) => d.data());
          state.subs = docs
            .filter((d) => d.kind === "sub")
            .map((d) => {
              const copy = Object.assign({}, d);
              delete copy.kind;
              return copy;
            });
          const remoteSettings = docs.find((d) => d.kind === "settings");
          if (remoteSettings && remoteSettings.currency) {
            state.settings.currency = remoteSettings.currency;
          }
          persistLocal();
          onStatus("Sincronizado con tu cuenta de Claude");
          onChange();
        },
        () => onStatus("Sin conexión con tu cuenta; usando los datos de este dispositivo."),
      );
    }

    const canDownload = () => !hasClaude() || Boolean(downloads);

    // Inside the viewer files go through the downloads capability; elsewhere a plain link.
    async function download(filename, content, type) {
      if (hasClaude()) {
        if (!downloads) {
          return false;
        }
        await downloads.save({ filename, data: content });
        return true;
      }
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }

    return {
      state,
      saveSub,
      deleteSub,
      replaceAll,
      saveSettings,
      connect,
      syncCloud,
      cloudState,
      mode,
      canDownload,
      download,
      load,
      save,
    };
  }

  root.SubStore = { createStore, hasClaude };
})(typeof globalThis !== "undefined" ? globalThis : this);
