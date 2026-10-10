// UI layer for the subscription manager. State lives in localStorage; every
// figure is recomputed from the current date so the app stays up to date.
(function () {
  "use strict";

  const S = window.SubSchedule;
  const STORAGE_KEY = "subs.v1";
  const SETTINGS_KEY = "subs.settings.v1";
  const NOTIFIED_KEY = "subs.notified.v1";
  const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- Storage ----------
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
    } catch {
      toast("No se pudo guardar en este navegador");
    }
  }

  let subs = load(STORAGE_KEY, []);
  let settings = Object.assign({ currency: "EUR" }, load(SETTINGS_KEY, {}));
  let notified = load(NOTIFIED_KEY, {});
  let calCursor = null; // {year, month} shown in the calendar view
  let selectedDay = null;
  let lastDayKey = "";

  const persist = () => save(STORAGE_KEY, subs);

  // ---------- Helpers ----------
  const now = () => new Date();
  const today = () => S.startOfDay(now());

  function money(value) {
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: settings.currency,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${settings.currency}`;
    }
  }

  function fmtDate(date, opts) {
    return date.toLocaleDateString(
      "es-ES",
      opts || { weekday: "short", day: "numeric", month: "short" },
    );
  }

  function relDays(days) {
    if (days === 0) {
      return "hoy";
    }
    if (days === 1) {
      return "mañana";
    }
    if (days === -1) {
      return "ayer";
    }
    return days > 0 ? `en ${days} días` : `hace ${-days} días`;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") {
        node.className = v;
      } else if (k === "text") {
        node.textContent = v;
      } else if (k === "style") {
        node.style.cssText = v;
      } else if (k.startsWith("on")) {
        node.addEventListener(k.slice(2), v);
      } else {
        node.setAttribute(k, v);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child != null) {
        node.append(child);
      }
    }
    return node;
  }

  function dot(color) {
    return el("span", { class: "dot", style: `background:${color || "#4f46e5"}` });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  const activeSubs = () => subs.filter((s) => s.active !== false);

  // ---------- Dashboard ----------
  function renderDashboard() {
    const ref = today();
    const sum = S.monthSummary(subs, ref);
    const active = activeSubs();
    const yearly = active.reduce((acc, s) => acc + S.yearlyCost(s), 0);

    $("#month-title").textContent = `${cap(MONTHS[sum.month])} ${sum.year}`;
    $("#stat-paid").textContent = money(sum.paidTotal);
    $("#stat-paid-count").textContent = `${sum.paid.length} cobro(s) realizados`;
    $("#stat-pending").textContent = money(sum.pendingTotal);
    $("#stat-pending-count").textContent = `${sum.pending.length} cobro(s) por llegar`;
    $("#stat-total").textContent = money(sum.total);
    $("#stat-active").textContent = `${active.length} suscripción(es) activas`;
    $("#stat-yearly").textContent = money(yearly);
    $("#stat-monthly-avg").textContent = `≈ ${money(yearly / 12)} / mes de media`;

    const pct = sum.total > 0 ? Math.round((sum.paidTotal / sum.total) * 100) : 0;
    $("#progress-bar").style.width = `${pct}%`;
    $("#progress-label").textContent =
      sum.total > 0
        ? `Llevas cobrado el ${pct}% del gasto de este mes · día ${ref.getDate()} de ${S.daysInMonth(sum.year, sum.month)}`
        : "No hay cobros previstos este mes.";

    const list = $("#month-charges");
    list.replaceChildren();
    if (!sum.charges.length) {
      list.append(el("li", { class: "empty", text: "Sin cobros este mes." }));
    }
    for (const c of sum.charges) {
      list.append(chargeItem(c, ref));
    }

    renderReminders(ref);
    renderCategories(active);
  }

  function chargeItem(c, ref) {
    const days = S.daysBetween(ref, c.date);
    const status = c.paid
      ? el("span", { class: "badge ok", text: days === 0 ? "Cobrado hoy" : "Cobrado" })
      : el("span", { class: "badge wait", text: relDays(days) });
    return el("li", { class: c.paid ? "paid" : "", onclick: () => openForm(c.sub) }, [
      dot(c.sub.color),
      el("div", { class: "grow" }, [
        el("strong", { text: c.sub.name }),
        el("small", { text: fmtDate(c.date) }),
      ]),
      el("span", { class: "amount", text: money(c.amount) }),
      status,
    ]);
  }

  function renderReminders(ref) {
    const box = $("#reminders");
    box.replaceChildren();
    const due = S.dueReminders(subs, ref);
    if (!due.length) {
      return;
    }
    const items = due.map((r) =>
      el("li", {}, [
        dot(r.sub.color),
        el("span", {
          class: "grow",
          text: `${r.sub.name} se renueva ${relDays(r.days)} (${fmtDate(r.date)})`,
        }),
        el("strong", { text: money(Number(r.sub.price) || 0) }),
      ]),
    );
    box.append(
      el("div", { class: "reminder-box" }, [
        el("h3", { text: "🔔 Próximas renovaciones" }),
        el("ul", {}, items),
      ]),
    );
  }

  function renderCategories(active) {
    const totals = new Map();
    for (const s of active) {
      const key = s.category || "Sin categoría";
      totals.set(key, (totals.get(key) || 0) + S.monthlyEquivalent(s));
    }
    const rows = [...totals.entries()].toSorted((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 0;
    const list = $("#categories");
    list.replaceChildren();
    if (!rows.length) {
      list.append(el("li", { class: "empty", text: "Añade suscripciones para ver el reparto." }));
    }
    for (const [name, value] of rows) {
      list.append(
        el("li", {}, [
          el("div", { class: "cat-row" }, [
            el("span", { text: name }),
            el("strong", { text: money(value) }),
          ]),
          el(
            "div",
            { class: "bar" },
            el("div", { style: `width:${max ? (value / max) * 100 : 0}%` }),
          ),
        ]),
      );
    }
  }

  // ---------- List ----------
  function renderList() {
    const ref = today();
    const q = $("#search").value.trim().toLowerCase();
    const cat = $("#filter-category").value;
    const sort = $("#sort").value;
    let rows = subs.filter((s) => {
      const hay = `${s.name} ${s.description || ""} ${s.category || ""}`.toLowerCase();
      return (!q || hay.includes(q)) && (!cat || (s.category || "") === cat);
    });
    const next = (s) => S.nextCharge(s, ref);
    rows.sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sort === "price") {
        return S.monthlyEquivalent(b) - S.monthlyEquivalent(a);
      }
      const na = next(a);
      const nb = next(b);
      return (na ? na.getTime() : Infinity) - (nb ? nb.getTime() : Infinity);
    });

    const box = $("#sub-list");
    box.replaceChildren();
    if (!rows.length) {
      box.append(
        el("p", {
          class: "empty",
          text: subs.length
            ? "Nada coincide con el filtro."
            : "Aún no tienes suscripciones. Pulsa «+ Añadir» o carga los ejemplos en Ajustes.",
        }),
      );
      return;
    }
    for (const s of rows) {
      box.append(subCard(s, ref));
    }
  }

  function subCard(s, ref) {
    const next = S.nextCharge(s, ref);
    const last = S.lastCharge(s, ref);
    const cycle = S.CYCLES[s.cycle] || S.CYCLES.monthly;
    const inactive = s.active === false || !next;
    const days = next ? S.daysBetween(ref, next) : null;
    const meta = [
      ["Precio", `${money(Number(s.price) || 0)} · ${cycle.label}`],
      ["Equivale a", `${money(S.monthlyEquivalent(s))} / mes · ${money(S.yearlyCost(s))} / año`],
      [
        "Próxima renovación",
        next
          ? `${fmtDate(next, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${relDays(days)})`
          : "—",
      ],
      [
        "Último cobro",
        last ? fmtDate(last, { day: "numeric", month: "long", year: "numeric" }) : "—",
      ],
      [
        "Día de cobro",
        cycle.months === 0
          ? `cada ${fmtDate(S.parseISO(s.startDate), { weekday: "long" })}`
          : `día ${S.parseISO(s.startDate).getDate()}`,
      ],
      s.paymentMethod ? ["Pago", s.paymentMethod] : null,
      ["Aviso", `${s.reminderDays ?? 3} día(s) antes`],
    ].filter(Boolean);

    return el(
      "article",
      {
        class: `sub-card${inactive ? " inactive" : ""}`,
        style: `--accent:${s.color || "#4f46e5"}`,
      },
      [
        el("header", {}, [
          el("div", { class: "grow" }, [
            el("h3", { text: s.name }),
            el("p", { class: "muted", text: s.description || "Sin descripción" }),
          ]),
          el("span", { class: "chip", text: s.category || "Sin categoría" }),
        ]),
        el(
          "dl",
          {},
          meta.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]),
        ),
        inactive
          ? el("p", { class: "badge off", text: s.active === false ? "Pausada" : "Dada de baja" })
          : null,
        el("footer", {}, [
          s.url && /^https?:\/\//i.test(s.url)
            ? el("a", {
                class: "btn small",
                href: s.url,
                target: "_blank",
                rel: "noopener",
                text: "Gestionar ↗",
              })
            : null,
          el("button", {
            class: "btn small",
            type: "button",
            text: "Editar",
            onclick: () => openForm(s),
          }),
        ]),
      ],
    );
  }

  function renderCategoryOptions() {
    const cats = [...new Set(subs.map((s) => s.category).filter(Boolean))].toSorted();
    const sel = $("#filter-category");
    const current = sel.value;
    sel.replaceChildren(
      el("option", { value: "", text: "Todas las categorías" }),
      ...cats.map((c) => el("option", { value: c, text: c })),
    );
    sel.value = cats.includes(current) ? current : "";
    const defaults = [
      "Streaming",
      "Música",
      "Software",
      "Nube",
      "Gaming",
      "Noticias",
      "Gimnasio",
      "Formación",
      "Otros",
    ];
    $("#category-options").replaceChildren(
      ...[...new Set([...defaults, ...cats])].map((c) => el("option", { value: c })),
    );
  }

  // ---------- Calendar ----------
  function renderCalendar() {
    const ref = today();
    if (!calCursor) {
      calCursor = { year: ref.getFullYear(), month: ref.getMonth() };
    }
    const { year, month } = calCursor;
    $("#cal-title").textContent = `${cap(MONTHS[month])} ${year}`;

    const byDay = new Map();
    let total = 0;
    for (const s of subs) {
      for (const d of S.chargesInMonth(s, year, month)) {
        const list = byDay.get(d.getDate()) || [];
        list.push({ sub: s, date: d, amount: Number(s.price) || 0, paid: d <= ref });
        byDay.set(d.getDate(), list);
        total += Number(s.price) || 0;
      }
    }
    $("#cal-total").textContent = `Total del mes: ${money(total)}`;

    const grid = $("#calendar");
    grid.replaceChildren(...WEEKDAYS.map((w) => el("div", { class: "wd", text: w })));
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
    for (let i = 0; i < offset; i++) {
      grid.append(el("div", { class: "day blank" }));
    }
    for (let d = 1; d <= S.daysInMonth(year, month); d++) {
      const date = new Date(year, month, d);
      const charges = byDay.get(d) || [];
      const classes = ["day"];
      if (date.getTime() === ref.getTime()) {
        classes.push("today");
      }
      if (date < ref) {
        classes.push("past");
      }
      if (selectedDay === d) {
        classes.push("selected");
      }
      if (charges.length) {
        classes.push("has");
      }
      grid.append(
        el(
          "button",
          {
            class: classes.join(" "),
            type: "button",
            onclick: () => {
              selectedDay = d;
              renderCalendar();
            },
          },
          [
            el("span", { class: "num", text: String(d) }),
            el(
              "span",
              { class: "dots" },
              charges.slice(0, 4).map((c) => dot(c.sub.color)),
            ),
            charges.length
              ? el("span", {
                  class: "day-sum",
                  text: money(charges.reduce((a, c) => a + c.amount, 0)),
                })
              : null,
          ],
        ),
      );
    }

    const detail = $("#cal-day-detail");
    detail.replaceChildren();
    if (selectedDay && byDay.has(selectedDay)) {
      for (const c of byDay.get(selectedDay)) {
        detail.append(chargeItem(c, ref));
      }
    } else if (selectedDay) {
      detail.append(el("li", { class: "empty", text: "Sin cobros este día." }));
    }
  }

  // ---------- Form ----------
  const dialog = $("#sub-dialog");
  const form = $("#sub-form");

  function openForm(sub) {
    form.reset();
    const data = sub || {
      startDate: S.toISO(today()),
      reminderDays: 3,
      cycle: "monthly",
      color: "#4f46e5",
      active: true,
    };
    for (const field of form.elements) {
      if (!field.name) {
        continue;
      }
      if (field.type === "checkbox") {
        field.checked = data[field.name] !== false;
      } else {
        field.value = data[field.name] ?? field.defaultValue ?? "";
      }
    }
    $("#form-title").textContent = sub ? `Editar ${sub.name}` : "Nueva suscripción";
    $("#delete-btn").hidden = !sub;
    dialog.showModal();
  }

  form.addEventListener("submit", (ev) => {
    if (ev.submitter && ev.submitter.value !== "save") {
      return;
    }
    // namedItem() avoids clashes with built-in properties (e.g. a field called "name").
    const f = (n) => form.elements.namedItem(n);
    const text = (n) => f(n).value.trim();
    const sub = {
      id: f("id").value || uid(),
      name: text("name"),
      description: text("description"),
      price: Math.max(0, parseFloat(f("price").value) || 0),
      cycle: f("cycle").value,
      startDate: f("startDate").value,
      reminderDays: Math.max(0, parseInt(f("reminderDays").value, 10) || 0),
      category: text("category"),
      paymentMethod: text("paymentMethod"),
      url: text("url"),
      color: f("color").value,
      endDate: f("endDate").value || "",
      active: f("active").checked,
    };
    const idx = subs.findIndex((s) => s.id === sub.id);
    if (idx >= 0) {
      subs[idx] = sub;
    } else {
      subs.push(sub);
    }
    persist();
    renderAll();
    toast(idx >= 0 ? "Suscripción actualizada" : "Suscripción añadida");
  });

  $("#delete-btn").addEventListener("click", () => {
    const id = form.elements.namedItem("id").value;
    const sub = subs.find((s) => s.id === id);
    if (!sub || !confirm(`¿Eliminar ${sub.name}?`)) {
      return;
    }
    subs = subs.filter((s) => s.id !== id);
    persist();
    dialog.close();
    renderAll();
    toast("Suscripción eliminada");
  });

  // ---------- Notifications ----------
  function updateNotifyStatus() {
    const status = $("#notify-status");
    if (!("Notification" in window)) {
      status.textContent = "Este navegador no soporta notificaciones.";
    } else if (Notification.permission === "granted") {
      status.textContent = "✅ Notificaciones activadas.";
    } else if (Notification.permission === "denied") {
      status.textContent = "Notificaciones bloqueadas en el navegador.";
    } else {
      status.textContent = "Notificaciones desactivadas.";
    }
  }

  async function showNotification(title, body) {
    try {
      const reg =
        "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) {
        await reg.showNotification(title, { body, icon: "icon.svg", tag: title });
      } else {
        new Notification(title, { body, icon: "icon.svg" });
      }
    } catch {
      /* ignore: some browsers only allow notifications from a SW */
    }
  }

  // Fires one notification per (subscription, renewal date) inside its reminder window.
  function checkNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const ref = today();
    let changed = false;
    for (const r of S.dueReminders(subs, ref)) {
      const key = `${r.sub.id}:${S.toISO(r.date)}`;
      if (notified[key]) {
        continue;
      }
      notified[key] = S.toISO(ref);
      changed = true;
      showNotification(
        `Renovación de ${r.sub.name} ${relDays(r.days)}`,
        `${money(Number(r.sub.price) || 0)} · ${fmtDate(r.date, { weekday: "long", day: "numeric", month: "long" })}`,
      );
    }
    // Drop keys for renewals that already passed.
    for (const key of Object.keys(notified)) {
      if (key.split(":")[1] < S.toISO(ref)) {
        delete notified[key];
        changed = true;
      }
    }
    if (changed) {
      save(NOTIFIED_KEY, notified);
    }
  }

  $("#notify-btn").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      return toast("Notificaciones no disponibles");
    }
    await Notification.requestPermission();
    updateNotifyStatus();
    checkNotifications();
  });

  // ---------- Import / export ----------
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("#ics-btn").addEventListener("click", () => {
    if (!activeSubs().length) {
      return toast("No hay suscripciones activas");
    }
    download("suscripciones.ics", window.SubIcs.buildIcs(subs, settings), "text/calendar");
  });

  $("#export-btn").addEventListener("click", () => {
    download(
      `suscripciones-${S.toISO(today())}.json`,
      JSON.stringify({ version: 1, settings, subs }, null, 2),
      "application/json",
    );
  });

  $("#import-input").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.subs;
      if (!Array.isArray(list)) {
        throw new Error("formato");
      }
      subs = list
        .filter((s) => s && s.name && s.startDate)
        .map((s) => Object.assign({ id: uid() }, s));
      if (data.settings) {
        settings = Object.assign(settings, data.settings);
      }
      persist();
      save(SETTINGS_KEY, settings);
      renderAll();
      toast(`${subs.length} suscripción(es) importadas`);
    } catch {
      toast("Archivo no válido");
    }
  });

  $("#demo-btn").addEventListener("click", () => {
    if (subs.length && !confirm("Se añadirán ejemplos a tus suscripciones. ¿Continuar?")) {
      return;
    }
    const ref = today();
    const day = (d, monthsBack) =>
      S.toISO(new Date(ref.getFullYear(), ref.getMonth() - (monthsBack || 1), d));
    subs.push(
      {
        id: uid(),
        name: "Netflix",
        description: "Plan Estándar sin anuncios",
        price: 13.99,
        cycle: "monthly",
        startDate: day(5),
        reminderDays: 2,
        category: "Streaming",
        color: "#e50914",
        active: true,
        url: "https://www.netflix.com/account",
      },
      {
        id: uid(),
        name: "Spotify",
        description: "Premium Familiar",
        price: 17.99,
        cycle: "monthly",
        startDate: day(12),
        reminderDays: 2,
        category: "Música",
        color: "#1db954",
        active: true,
        url: "https://www.spotify.com/account",
      },
      {
        id: uid(),
        name: "iCloud+",
        description: "200 GB de almacenamiento",
        price: 2.99,
        cycle: "monthly",
        startDate: day(20),
        reminderDays: 1,
        category: "Nube",
        color: "#3b82f6",
        active: true,
      },
      {
        id: uid(),
        name: "Amazon Prime",
        description: "Envíos gratis + Prime Video",
        price: 49.9,
        cycle: "yearly",
        startDate: day(Math.min(28, ref.getDate() + 6), 12),
        reminderDays: 7,
        category: "Streaming",
        color: "#ff9900",
        active: true,
      },
      {
        id: uid(),
        name: "Gimnasio",
        description: "Cuota mensual",
        price: 34.9,
        cycle: "monthly",
        startDate: day(1),
        reminderDays: 3,
        category: "Gimnasio",
        color: "#a855f7",
        active: true,
      },
    );
    persist();
    renderAll();
    toast("Ejemplos cargados");
  });

  $("#clear-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todas las suscripciones? Esta acción no se puede deshacer.")) {
      return;
    }
    subs = [];
    notified = {};
    persist();
    save(NOTIFIED_KEY, notified);
    renderAll();
  });

  $("#currency").addEventListener("change", (ev) => {
    settings.currency = ev.target.value;
    save(SETTINGS_KEY, settings);
    renderAll();
  });

  // ---------- Navigation ----------
  function showView(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    try {
      sessionStorage.setItem("subs.view", name);
    } catch {
      /* ignore */
    }
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  $("#add-btn").addEventListener("click", () => openForm(null));
  ["#search", "#filter-category", "#sort"].forEach((s) =>
    $(s).addEventListener("input", renderList),
  );
  const shiftMonth = (delta) => {
    const d = new Date(calCursor.year, calCursor.month + delta, 1);
    calCursor = { year: d.getFullYear(), month: d.getMonth() };
    selectedDay = null;
    renderCalendar();
  };
  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));
  $("#cal-today").addEventListener("click", () => {
    calCursor = null;
    selectedDay = today().getDate();
    renderCalendar();
  });

  // ---------- Real-time refresh ----------
  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function renderClock() {
    const d = now();
    $("#clock").textContent =
      cap(
        d.toLocaleDateString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      ) +
      " · " +
      d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }

  function renderAll() {
    $("#currency").value = settings.currency;
    renderCategoryOptions();
    renderDashboard();
    renderList();
    renderCalendar();
    updateNotifyStatus();
    checkNotifications();
    lastDayKey = S.toISO(today());
  }

  // Ticks every 20s; when the day changes everything (paid/pending split,
  // next renewals, reminders) is recalculated automatically.
  function tick() {
    renderClock();
    if (S.toISO(today()) !== lastDayKey) {
      if (calCursor && lastDayKey) {
        const prev = S.parseISO(lastDayKey);
        if (calCursor.year === prev.getFullYear() && calCursor.month === prev.getMonth()) {
          calCursor = null;
        }
      }
      renderAll();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tick();
    }
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key === STORAGE_KEY) {
      subs = load(STORAGE_KEY, []);
      renderAll();
    }
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  try {
    const view = sessionStorage.getItem("subs.view");
    if (view && $(`#view-${view}`)) {
      showView(view);
    }
  } catch {
    /* ignore */
  }
  renderClock();
  renderAll();
  setInterval(tick, 20_000);
})();
