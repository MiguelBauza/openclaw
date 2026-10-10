// UI layer for the subscription manager. Every figure is recomputed from the
// current date, so paid/pending totals and renewals stay up to date on their own.
(function () {
  "use strict";

  const S = window.SubSchedule;
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
  const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
  const SWATCHES = [
    "#ff3b30",
    "#ff9500",
    "#ffcc00",
    "#34c759",
    "#00c7be",
    "#30b0c7",
    "#007aff",
    "#5856d6",
    "#af52de",
    "#ff2d55",
    "#a2845e",
    "#8e8e93",
  ];
  const NOTIFIED_KEY = "subs.notified.v1";
  // Embedded in the Claude viewer (no service worker, notifications or .ics there).
  const EMBEDDED = window.SubStore.hasClaude() || window.self !== window.top;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let cloudUI = null;
  const STORAGE_NOTES = {
    claude: "Tus suscripciones se guardan en tu cuenta de Claude y solo tú las ves.",
    cloud:
      "Tus suscripciones se guardan en tu cuenta en la nube y se sincronizan entre dispositivos.",
    local: "Tus datos se guardan solo en este dispositivo.",
  };
  const store = window.SubStore.createStore({
    onChange: () => renderAll(),
    onStatus: (text) => {
      const node = $("#sync-status");
      node.textContent = text;
      node.hidden = !text;
      $("#storage-note").textContent = STORAGE_NOTES[store.mode()];
    },
    onCloud: () => {
      if (cloudUI) {
        cloudUI.render();
      }
      $("#storage-note").textContent = STORAGE_NOTES[store.mode()];
    },
  });
  const subs = () => store.state.subs;
  const settings = store.state.settings;

  let notified = store.load(NOTIFIED_KEY, {});
  let calCursor = null;
  let selectedDay = null;
  let lastDayKey = "";

  // ---------- Helpers ----------
  const today = () => S.startOfDay(new Date());
  const price = (sub) => Number(sub.price) || 0;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
    return days > 0 ? `en ${days} días` : `hace ${-days} días`;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
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

  // App-icon style avatar: rounded square, colour gradient, first letter.
  function avatar(sub, size) {
    const color = sub.color || "#8e8e93";
    return el("span", {
      class: `avatar${size ? ` ${size}` : ""}`,
      style: `--c:${color}`,
      text: (sub.name || "?").trim().charAt(0).toUpperCase(),
      "aria-hidden": "true",
    });
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

  // In-page confirmation (the Claude viewer blocks window.confirm).
  function askConfirm(message, okLabel) {
    const box = $("#confirm-dialog");
    $("#confirm-text").textContent = message;
    $("#confirm-ok").textContent = okLabel || "Aceptar";
    box.returnValue = "";
    box.showModal();
    return new Promise((resolve) => {
      box.addEventListener("close", () => resolve(box.returnValue === "ok"), { once: true });
    });
  }

  const activeSubs = () => subs().filter((s) => s.active !== false);

  // ---------- Dashboard ----------
  function renderDashboard() {
    const ref = today();
    const sum = S.monthSummary(subs(), ref);
    const active = activeSubs();
    const yearly = active.reduce((acc, s) => acc + S.yearlyCost(s), 0);
    const pct = sum.total > 0 ? Math.round((sum.paidTotal / sum.total) * 100) : 0;

    $("#empty-state").hidden = subs().length > 0;
    $("#month-title").textContent = `${cap(MONTHS[sum.month])} ${sum.year}`;
    $("#stat-pending").textContent = money(sum.pendingTotal);
    $("#stat-pending-count").textContent = sum.pending.length
      ? `${plural(sum.pending.length, "cobro", "cobros")} por llegar este mes`
      : "No te queda nada por pagar este mes";
    $("#stat-paid").textContent = money(sum.paidTotal);
    $("#stat-paid-count").textContent = plural(sum.paid.length, "cobro", "cobros");
    $("#stat-total").textContent = money(sum.total);
    $("#month-progress").textContent =
      `Día ${ref.getDate()} de ${S.daysInMonth(sum.year, sum.month)}`;
    $("#stat-yearly").textContent = money(yearly);
    $("#stat-monthly-avg").textContent = money(yearly / 12);
    $("#stat-active").textContent = String(active.length);

    // Ring: circumference of r=50 is 2πr.
    const circ = 2 * Math.PI * 50;
    const ring = $("#ring-value");
    ring.style.strokeDasharray = `${circ}`;
    ring.style.strokeDashoffset = `${circ * (1 - pct / 100)}`;
    ring.classList.toggle("zero", pct === 0);
    $("#ring-pct").textContent = `${pct}%`;
    $("#ring").setAttribute("aria-label", `Cobrado el ${pct}% del gasto del mes`);

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
      ? el("span", { class: "pill paid", text: days === 0 ? "Cobrado hoy" : "Cobrado" })
      : el("span", {
          class: `pill ${days <= (c.sub.reminderDays ?? 3) ? "soon" : "wait"}`,
          text: cap(relDays(days)),
        });
    return el("li", { class: `row-item tappable${c.paid ? " is-paid" : ""}` }, [
      avatar(c.sub),
      el("div", { class: "grow" }, [
        el("strong", { text: c.sub.name }),
        el("small", {
          text: cap(fmtDate(c.date, { weekday: "long", day: "numeric", month: "long" })),
        }),
      ]),
      el("div", { class: "trail" }, [
        el("span", { class: "amount", text: money(c.amount) }),
        status,
      ]),
    ]);
  }

  function renderReminders(ref) {
    const box = $("#reminders");
    box.replaceChildren();
    const due = S.dueReminders(subs(), ref);
    if (!due.length) {
      return;
    }
    box.append(
      el("section", { class: "reminder-card", "aria-label": "Próximas renovaciones" }, [
        el("p", { class: "eyebrow", text: "Próximas renovaciones" }),
        el(
          "ul",
          {},
          due.map((r) =>
            el("li", {}, [
              avatar(r.sub, "sm"),
              el("span", { class: "grow" }, [
                el("strong", { text: r.sub.name }),
                ` se renueva ${relDays(r.days)}`,
              ]),
              el("span", { class: "amount", text: money(price(r.sub)) }),
            ]),
          ),
        ),
      ]),
    );
  }

  function renderCategories(active) {
    const totals = new Map();
    for (const s of active) {
      const key = s.category || "Sin categoría";
      const entry = totals.get(key) || { value: 0, color: s.color || "#8e8e93" };
      entry.value += S.monthlyEquivalent(s);
      totals.set(key, entry);
    }
    const rows = [...totals.entries()].toSorted((a, b) => b[1].value - a[1].value);
    const total = rows.reduce((acc, [, e]) => acc + e.value, 0);
    $("#category-bar").replaceChildren(
      ...rows.map(([name, e]) =>
        el("span", { style: `flex:${e.value} 1 0;--c:${e.color}`, title: name }),
      ),
    );
    const list = $("#categories");
    list.replaceChildren();
    if (!rows.length) {
      list.append(el("li", { class: "empty", text: "Añade suscripciones para ver el reparto." }));
    }
    for (const [name, e] of rows) {
      list.append(
        el("li", {}, [
          el("span", { class: "legend", style: `--c:${e.color}` }),
          el("span", { class: "grow", text: name }),
          el("span", { class: "muted pct", text: `${Math.round((e.value / total) * 100)}%` }),
          el("strong", { class: "amount", text: money(e.value) }),
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
    const next = (s) => S.nextCharge(s, ref);
    const rows = subs()
      .filter((s) => {
        const hay = `${s.name} ${s.description || ""} ${s.category || ""}`.toLowerCase();
        return (!q || hay.includes(q)) && (!cat || (s.category || "") === cat);
      })
      .toSorted((a, b) => {
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
          text: subs().length
            ? "Nada coincide con la búsqueda."
            : "Aún no tienes suscripciones. Pulsa + para añadir la primera.",
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
    const start = S.parseISO(s.startDate);
    const meta = [
      [
        "Próximo cobro",
        next ? cap(fmtDate(next, { weekday: "long", day: "numeric", month: "long" })) : "—",
      ],
      [
        "Último cobro",
        last ? fmtDate(last, { day: "numeric", month: "long", year: "numeric" }) : "—",
      ],
      [
        "Día de cobro",
        cycle.months === 0
          ? `Cada ${fmtDate(start, { weekday: "long" })}`
          : `Día ${start.getDate()}`,
      ],
      ["Al mes / al año", `${money(S.monthlyEquivalent(s))} · ${money(S.yearlyCost(s))}`],
      s.paymentMethod ? ["Pago", s.paymentMethod] : null,
      ["Aviso", `${plural(s.reminderDays ?? 3, "día", "días")} antes`],
    ].filter(Boolean);

    let status;
    if (s.active === false) {
      status = el("span", { class: "pill off", text: "Pausada" });
    } else if (!next) {
      status = el("span", { class: "pill off", text: "Dada de baja" });
    } else {
      status = el("span", {
        class: `pill ${days <= (s.reminderDays ?? 3) ? "soon" : "wait"}`,
        text: cap(relDays(days)),
      });
    }

    return el(
      "article",
      { class: `sub-card${inactive ? " inactive" : ""}`, style: `--c:${s.color || "#8e8e93"}` },
      [
        el("header", {}, [
          avatar(s, "lg"),
          el("div", { class: "grow" }, [
            el("h3", { text: s.name }),
            el("p", { class: "muted", text: s.description || s.category || "Sin descripción" }),
          ]),
        ]),
        el("div", { class: "price-row" }, [
          el("p", { class: "price" }, [
            money(price(s)),
            el("span", { text: ` / ${cycle.label.toLowerCase()}` }),
          ]),
          status,
        ]),
        el(
          "dl",
          {},
          meta.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]),
        ),
        el("footer", {}, [
          s.category ? el("span", { class: "chip", text: s.category }) : null,
          el("span", { class: "grow" }),
          s.url && /^https?:\/\//i.test(s.url)
            ? el("a", {
                class: "btn small ghost",
                href: s.url,
                target: "_blank",
                rel: "noopener",
                text: "Gestionar",
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
    const cats = [
      ...new Set(
        subs()
          .map((s) => s.category)
          .filter(Boolean),
      ),
    ].toSorted();
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
    for (const s of subs()) {
      for (const d of S.chargesInMonth(s, year, month)) {
        const list = byDay.get(d.getDate()) || [];
        list.push({ sub: s, date: d, amount: price(s), paid: d <= ref });
        byDay.set(d.getDate(), list);
        total += price(s);
      }
    }
    $("#cal-total").textContent = `${money(total)} en total`;

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
      grid.append(
        el(
          "button",
          {
            class: classes.join(" "),
            type: "button",
            "aria-label": `${d} de ${MONTHS[month]}${charges.length ? `, ${plural(charges.length, "cobro", "cobros")}` : ""}`,
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
              charges.slice(0, 3).map((c) => el("i", { style: `--c:${c.sub.color || "#8e8e93"}` })),
            ),
          ],
        ),
      );
    }

    const detail = $("#cal-day-detail");
    detail.replaceChildren();
    if (selectedDay) {
      const date = new Date(year, month, selectedDay);
      $("#cal-day-title").textContent = cap(
        fmtDate(date, { weekday: "long", day: "numeric", month: "long" }),
      );
      const charges = byDay.get(selectedDay) || [];
      if (!charges.length) {
        detail.append(el("li", { class: "empty", text: "Sin cobros este día." }));
      }
      for (const c of charges) {
        detail.append(chargeItem(c, ref));
      }
    } else {
      $("#cal-day-title").textContent = "Toca un día para ver sus cobros";
    }
  }

  // ---------- Form ----------
  const dialog = $("#sub-dialog");
  const form = $("#sub-form");
  const field = (n) => form.elements.namedItem(n);

  function renderSwatches(selected) {
    $("#swatches").replaceChildren(
      ...SWATCHES.map((c) =>
        el("button", {
          type: "button",
          class: `swatch${c === selected ? " on" : ""}`,
          style: `--c:${c}`,
          role: "radio",
          "aria-checked": String(c === selected),
          "aria-label": c,
          onclick: () => {
            field("color").value = c;
            renderSwatches(c);
          },
        }),
      ),
    );
  }

  function openForm(sub) {
    form.reset();
    const data = sub || {
      startDate: S.toISO(today()),
      reminderDays: 3,
      cycle: "monthly",
      color: SWATCHES[subs().length % SWATCHES.length],
      active: true,
    };
    for (const input of form.elements) {
      if (!input.name) {
        continue;
      }
      if (input.type === "checkbox") {
        input.checked = data[input.name] !== false;
      } else {
        input.value = data[input.name] ?? input.defaultValue ?? "";
      }
    }
    renderSwatches(field("color").value);
    $("#form-title").textContent = sub ? "Editar" : "Nueva suscripción";
    $("#delete-btn").hidden = !sub;
    dialog.showModal();
  }

  form.addEventListener("submit", (ev) => {
    if (ev.submitter && ev.submitter.value !== "save") {
      return;
    }
    const text = (n) => field(n).value.trim();
    const sub = {
      id: field("id").value || uid(),
      name: text("name"),
      description: text("description"),
      price: Math.max(0, parseFloat(field("price").value) || 0),
      cycle: field("cycle").value,
      startDate: field("startDate").value,
      reminderDays: Math.max(0, parseInt(field("reminderDays").value, 10) || 0),
      category: text("category"),
      paymentMethod: text("paymentMethod"),
      url: text("url"),
      color: field("color").value || "#8e8e93",
      endDate: field("endDate").value || "",
      active: field("active").checked,
    };
    const added = store.saveSub(sub);
    renderAll();
    toast(added ? "Suscripción añadida" : "Cambios guardados");
  });

  $("#delete-btn").addEventListener("click", async () => {
    const id = field("id").value;
    const sub = subs().find((s) => s.id === id);
    dialog.close();
    if (!sub || !(await askConfirm(`¿Eliminar ${sub.name}?`, "Eliminar"))) {
      return;
    }
    store.deleteSub(id);
    renderAll();
    toast("Suscripción eliminada");
  });

  // ---------- Notifications (installed app only) ----------
  function updateNotifyStatus() {
    const status = $("#notify-status");
    const btn = $("#notify-btn");
    if (!("Notification" in window)) {
      status.textContent = "No disponibles en este navegador";
      btn.hidden = true;
    } else if (Notification.permission === "granted") {
      status.textContent = "Activadas";
      btn.hidden = true;
    } else if (Notification.permission === "denied") {
      status.textContent = "Bloqueadas en los ajustes del navegador";
      btn.hidden = true;
    } else {
      status.textContent = "Te avisan de cada renovación";
      btn.hidden = false;
    }
  }

  async function showNotification(title, body) {
    try {
      const reg =
        "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
          tag: title,
        });
      } else {
        new Notification(title, { body, icon: "icons/icon-192.png" });
      }
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }

  // One notification per (subscription, renewal date) inside its reminder window.
  function checkNotifications() {
    if (EMBEDDED || !("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const ref = today();
    let changed = false;
    for (const r of S.dueReminders(subs(), ref)) {
      const key = `${r.sub.id}:${S.toISO(r.date)}`;
      if (notified[key]) {
        continue;
      }
      notified[key] = S.toISO(ref);
      changed = true;
      showNotification(
        `${r.sub.name} se renueva ${relDays(r.days)}`,
        `${money(price(r.sub))} · ${fmtDate(r.date, { weekday: "long", day: "numeric", month: "long" })}`,
      );
    }
    for (const key of Object.keys(notified)) {
      if (key.split(":")[1] < S.toISO(ref)) {
        delete notified[key];
        changed = true;
      }
    }
    if (changed) {
      store.save(NOTIFIED_KEY, notified);
    }
  }

  $("#notify-btn").addEventListener("click", async () => {
    await Notification.requestPermission();
    updateNotifyStatus();
    checkNotifications();
  });

  // ---------- Install (PWA) ----------
  let installPrompt = null;
  function setupInstall() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (EMBEDDED || standalone) {
      return;
    }
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      $("#install-help").textContent =
        "En Safari, pulsa Compartir y luego «Añadir a pantalla de inicio».";
      $("#install-group").hidden = false;
    }
    window.addEventListener("beforeinstallprompt", (ev) => {
      ev.preventDefault();
      installPrompt = ev;
      $("#install-group").hidden = false;
      $("#install-btn").hidden = false;
    });
    $("#install-btn").addEventListener("click", async () => {
      if (!installPrompt) {
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      $("#install-group").hidden = true;
    });
  }

  // ---------- Import / export ----------
  async function offerDownload(name, content, type) {
    try {
      if (await store.download(name, content, type)) {
        toast("Archivo listo");
      }
    } catch (err) {
      if (!err || err.code !== "declined") {
        toast("No se pudo guardar el archivo");
      }
    }
  }

  $("#ics-btn").addEventListener("click", () => {
    if (!activeSubs().length) {
      return toast("No hay suscripciones activas");
    }
    offerDownload("suscripciones.ics", window.SubIcs.buildIcs(subs(), settings), "text/calendar");
  });

  $("#export-btn").addEventListener("click", () => {
    offerDownload(
      `suscripciones-${S.toISO(today())}.json`,
      JSON.stringify({ version: 1, settings, subs: subs() }, null, 2),
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
      const clean = list
        .filter((s) => s && s.name && s.startDate)
        .map((s) => Object.assign({ id: uid() }, s));
      if (data.settings && data.settings.currency) {
        store.saveSettings({ currency: data.settings.currency });
      }
      store.replaceAll(clean);
      renderAll();
      toast(`${plural(clean.length, "suscripción importada", "suscripciones importadas")}`);
    } catch {
      toast("Ese archivo no es una copia válida");
    }
  });

  async function loadDemo() {
    if (
      subs().length &&
      !(await askConfirm("Se añadirán cinco ejemplos a tus suscripciones.", "Añadir"))
    ) {
      return;
    }
    const ref = today();
    const day = (d, monthsBack) =>
      S.toISO(new Date(ref.getFullYear(), ref.getMonth() - (monthsBack || 1), d));
    const base = { active: true, endDate: "", paymentMethod: "" };
    [
      {
        name: "Netflix",
        description: "Plan Estándar sin anuncios",
        price: 13.99,
        cycle: "monthly",
        startDate: day(5),
        reminderDays: 2,
        category: "Streaming",
        color: "#ff3b30",
        url: "https://www.netflix.com/account",
      },
      {
        name: "Spotify",
        description: "Premium Familiar",
        price: 17.99,
        cycle: "monthly",
        startDate: day(12),
        reminderDays: 2,
        category: "Música",
        color: "#34c759",
        url: "https://www.spotify.com/account",
      },
      {
        name: "iCloud+",
        description: "200 GB de almacenamiento",
        price: 2.99,
        cycle: "monthly",
        startDate: day(20),
        reminderDays: 1,
        category: "Nube",
        color: "#007aff",
      },
      {
        name: "Amazon Prime",
        description: "Envíos gratis y Prime Video",
        price: 49.9,
        cycle: "yearly",
        startDate: day(Math.min(28, ref.getDate() + 6), 12),
        reminderDays: 7,
        category: "Streaming",
        color: "#ff9500",
      },
      {
        name: "Gimnasio",
        description: "Cuota mensual",
        price: 34.9,
        cycle: "monthly",
        startDate: day(1),
        reminderDays: 3,
        category: "Deporte",
        color: "#af52de",
      },
    ].forEach((s) => store.saveSub(Object.assign({ id: uid() }, base, s)));
    renderAll();
    toast("Ejemplos añadidos: edítalos o bórralos cuando quieras");
  }
  $("#demo-btn").addEventListener("click", loadDemo);
  $("#empty-demo").addEventListener("click", loadDemo);
  $("#empty-add").addEventListener("click", () => openForm(null));

  $("#clear-btn").addEventListener("click", async () => {
    if (
      !(await askConfirm("¿Borrar todas las suscripciones? No se puede deshacer.", "Borrar todo"))
    ) {
      return;
    }
    notified = {};
    store.save(NOTIFIED_KEY, notified);
    store.replaceAll([]);
    renderAll();
  });

  $("#currency").addEventListener("change", (ev) => {
    store.saveSettings({ currency: ev.target.value });
    renderAll();
  });

  // ---------- Navigation ----------
  function showView(name) {
    const view = $(`#view-${name}`);
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    $$(".view").forEach((v) => v.classList.toggle("active", v === view));
    $("#page-title").textContent = view.dataset.title;
    window.scrollTo({ top: 0 });
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
  function renderClock() {
    $("#today-label").textContent = new Date()
      .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
      .toUpperCase();
  }

  function renderAll() {
    $("#currency").value = settings.currency;
    $("#export-row").hidden = !store.canDownload();
    $("#storage-note").textContent = STORAGE_NOTES[store.mode()];
    renderClock();
    renderCategoryOptions();
    renderDashboard();
    renderList();
    renderCalendar();
    if (!EMBEDDED) {
      updateNotifyStatus();
      checkNotifications();
    }
    lastDayKey = S.toISO(today());
  }

  // Ticks every 20 s; when the day changes everything (paid/pending split,
  // next renewals, reminders) is recalculated automatically.
  function tick() {
    if (S.toISO(today()) === lastDayKey) {
      return;
    }
    if (calCursor && lastDayKey) {
      const prev = S.parseISO(lastDayKey);
      if (calCursor.year === prev.getFullYear() && calCursor.month === prev.getMonth()) {
        calCursor = null;
      }
    }
    renderAll();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tick();
    }
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key === "subs.v1") {
      store.state.subs = store.load("subs.v1", []);
      renderAll();
    }
  });

  if (EMBEDDED) {
    $$("[data-pwa]").forEach((node) => node.remove());
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  setupInstall();
  cloudUI = window.SubCloudUI ? window.SubCloudUI.mount({ store, toast }) : null;

  // Home-screen shortcut "Añadir suscripción" opens ./?add
  const params = new URLSearchParams(location.search);
  try {
    const view = params.get("view") || sessionStorage.getItem("subs.view");
    if (view && $(`#view-${view}`)) {
      showView(view);
    }
  } catch {
    /* ignore */
  }
  renderAll();
  if (params.has("add")) {
    openForm(null);
  }
  store.connect().catch(() => {});
  setInterval(tick, 20_000);
})();
