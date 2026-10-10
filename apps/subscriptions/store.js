// Persistence for the subscription manager. Always keeps a localStorage copy;
// when the page runs inside a Claude artifact viewer it also syncs to the
// viewer's private `db` subtree (data/users/<id>/...) so data follows the account.
// Exposes `globalThis.SubStore`.
(function (root) {
  "use strict";

  const SUBS_KEY = "subs.v1";
  const SETTINGS_KEY = "subs.settings.v1";
  const SYNCED_KEY = "subs.synced.v1";

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
    const state = {
      subs: load(SUBS_KEY, []),
      settings: Object.assign({ currency: "EUR" }, load(SETTINGS_KEY, {})),
    };
    let remote = null;
    let downloads = null;

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
      return idx < 0;
    }

    function deleteSub(id) {
      state.subs = state.subs.filter((s) => s.id !== id);
      persistLocal();
      if (remote) {
        subDoc(id).delete().catch(fail);
      }
    }

    async function replaceAll(list) {
      const previous = state.subs;
      state.subs = list.slice();
      persistLocal();
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
      if (remote) {
        remote
          .doc("settings")
          .set(Object.assign({ kind: "settings" }, state.settings))
          .catch(fail);
      }
    }

    async function connect() {
      if (!hasClaude()) {
        onStatus("");
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
      canDownload,
      download,
      load,
      save,
    };
  }

  root.SubStore = { createStore, hasClaude };
})(typeof globalThis !== "undefined" ? globalThis : this);
