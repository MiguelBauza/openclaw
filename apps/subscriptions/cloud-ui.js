// Ajustes → "Cuenta en la nube": connect a Supabase project, sign in with an
// emailed one-time code, and show sync state. Exposes `globalThis.SubCloudUI`.
(function (root) {
  "use strict";

  function mount({ store, toast }) {
    const cloud = root.SubCloud;
    const $ = (sel) => document.querySelector(sel);
    if (!cloud || !$("#cloud-group")) {
      return { render() {} };
    }
    let codeSentTo = "";

    function busy(button, on, label) {
      button.disabled = on;
      if (label) {
        button.textContent = label;
      }
    }

    function syncText(st) {
      if (st.syncing) {
        return "Sincronizando…";
      }
      if (st.error) {
        return st.pending
          ? `Sin conexión: ${st.pending} cambio(s) pendiente(s) de subir`
          : "Sin conexión con la nube";
      }
      if (st.last) {
        const time = st.last.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
        return `Sincronizado a las ${time}`;
      }
      return "Conectado";
    }

    function render() {
      const st = store.cloudState();
      $("#cloud-setup").hidden = st.configured;
      $("#cloud-login").hidden = !st.configured || st.signedIn;
      $("#cloud-account").hidden = !st.signedIn;
      $("#sb-code-row").hidden = !codeSentTo;
      if (st.signedIn) {
        $("#sb-user").textContent = st.email;
        $("#sb-sync").textContent = syncText(st);
        $("#sb-dot").className = `cloud-dot${st.syncing ? " busy" : st.error ? " off" : ""}`;
      }
    }

    $("#cloud-setup").addEventListener("submit", (ev) => {
      ev.preventDefault();
      try {
        cloud.setConfig($("#sb-url").value, $("#sb-key").value);
        toast("Proyecto conectado. Ahora entra con tu email.");
      } catch (err) {
        toast(err.message);
      }
      render();
    });

    $("#cloud-login").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = $("#sb-email").value.trim();
      const btn = $("#sb-send");
      busy(btn, true, "Enviando…");
      try {
        await cloud.sendCode(email);
        codeSentTo = email;
        toast(`Código enviado a ${email}`);
        render();
        $("#sb-code").focus();
      } catch (err) {
        toast(
          err.status === 429
            ? "Demasiados intentos. Espera unos minutos y vuelve a pedir el código."
            : `No se pudo enviar el código: ${err.message}`,
        );
      } finally {
        busy(btn, false, codeSentTo ? "Reenviar código" : "Enviarme el código");
      }
    });

    $("#sb-verify").addEventListener("click", async () => {
      const code = $("#sb-code").value.replace(/\s+/g, "");
      if (!codeSentTo || !code) {
        return toast("Escribe el código que te ha llegado por email");
      }
      const btn = $("#sb-verify");
      busy(btn, true, "Comprobando…");
      try {
        await cloud.verifyCode(codeSentTo, code);
        codeSentTo = "";
        $("#sb-code").value = "";
        toast("Sesión iniciada. Sincronizando tus suscripciones…");
        render();
        await store.syncCloud();
      } catch {
        toast("Ese código no es válido o ha caducado. Pide uno nuevo.");
      } finally {
        busy(btn, false, "Entrar");
        render();
      }
    });

    $("#sb-reset").addEventListener("click", () => {
      cloud.clearConfig();
      codeSentTo = "";
      render();
    });

    $("#sb-sync-now").addEventListener("click", () => store.syncCloud());

    $("#sb-logout").addEventListener("click", async () => {
      await cloud.signOut();
      toast("Sesión cerrada. Tus datos siguen en este dispositivo.");
      render();
      store.syncCloud();
    });

    render();
    return { render };
  }

  root.SubCloudUI = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
