// Pure date/billing logic for the subscription manager.
// Classic script (no ES modules) so index.html also works when opened via file://.
// Exposes `globalThis.SubSchedule`.
(function (root) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  // Billing cycles: months between charges (weekly is handled separately).
  const CYCLES = {
    weekly: { label: "Semanal", months: 0, perYear: 52 },
    monthly: { label: "Mensual", months: 1, perYear: 12 },
    quarterly: { label: "Trimestral", months: 3, perYear: 4 },
    semiannual: { label: "Semestral", months: 6, perYear: 2 },
    yearly: { label: "Anual", months: 12, perYear: 1 },
  };

  function parseISO(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Whole calendar days from `a` to `b` (DST-safe thanks to rounding).
  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
  }

  // k-th charge date (k = 0 is the start date). Monthly-style cycles keep the
  // anchor day and clamp it to the month length (31 -> 30 / 28 / 29).
  function occurrence(sub, k) {
    const start = parseISO(sub.startDate);
    const cycle = CYCLES[sub.cycle] || CYCLES.monthly;
    if (cycle.months === 0) {
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * k);
    }
    const total = start.getMonth() + cycle.months * k;
    const year = start.getFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const day = Math.min(start.getDate(), daysInMonth(year, month));
    return new Date(year, month, day);
  }

  // Index of the first occurrence that could be on/after `date` (may undershoot).
  function firstIndexNear(sub, date) {
    const start = parseISO(sub.startDate);
    const cycle = CYCLES[sub.cycle] || CYCLES.monthly;
    if (cycle.months === 0) {
      return Math.max(0, Math.floor(daysBetween(start, date) / 7) - 1);
    }
    const months =
      (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
    return Math.max(0, Math.floor(months / cycle.months) - 1);
  }

  function isAfterEnd(sub, date) {
    return Boolean(sub.endDate) && date > parseISO(sub.endDate);
  }

  // All charge dates within [from, to] (inclusive, day precision).
  function chargesInRange(sub, from, to) {
    const out = [];
    if (!sub || !sub.startDate || sub.active === false) {
      return out;
    }
    const lo = startOfDay(from);
    const hi = startOfDay(to);
    for (let k = firstIndexNear(sub, lo); ; k++) {
      const date = occurrence(sub, k);
      if (date > hi || isAfterEnd(sub, date)) {
        break;
      }
      if (date >= lo) {
        out.push(date);
      }
    }
    return out;
  }

  function chargesInMonth(sub, year, month) {
    return chargesInRange(
      sub,
      new Date(year, month, 1),
      new Date(year, month, daysInMonth(year, month)),
    );
  }

  // Next charge on or after `today` (a charge due today counts as "next").
  function nextCharge(sub, today) {
    if (!sub || !sub.startDate || sub.active === false) {
      return null;
    }
    const ref = startOfDay(today);
    for (let k = firstIndexNear(sub, ref); ; k++) {
      const date = occurrence(sub, k);
      if (isAfterEnd(sub, date)) {
        return null;
      }
      if (date >= ref) {
        return date;
      }
    }
  }

  function lastCharge(sub, today) {
    if (!sub || !sub.startDate) {
      return null;
    }
    const ref = startOfDay(today);
    let last = null;
    for (let k = firstIndexNear(sub, ref); ; k++) {
      const date = occurrence(sub, k);
      if (date >= ref || isAfterEnd(sub, date)) {
        return last;
      }
      last = date;
    }
  }

  function yearlyCost(sub) {
    const cycle = CYCLES[sub.cycle] || CYCLES.monthly;
    return (Number(sub.price) || 0) * cycle.perYear;
  }

  function monthlyEquivalent(sub) {
    return yearlyCost(sub) / 12;
  }

  // Month overview relative to `today`: charges already made (date <= today)
  // vs. charges still pending this month.
  function monthSummary(subs, today) {
    const ref = startOfDay(today);
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const charges = [];
    for (const sub of subs) {
      for (const date of chargesInMonth(sub, year, month)) {
        charges.push({ sub, date, amount: Number(sub.price) || 0, paid: date <= ref });
      }
    }
    charges.sort((a, b) => a.date - b.date || a.sub.name.localeCompare(b.sub.name));
    const sum = (list) => list.reduce((acc, c) => acc + c.amount, 0);
    const paid = charges.filter((c) => c.paid);
    const pending = charges.filter((c) => !c.paid);
    return {
      year,
      month,
      charges,
      paid,
      pending,
      paidTotal: sum(paid),
      pendingTotal: sum(pending),
      total: sum(charges),
    };
  }

  // Subscriptions whose next charge falls within their reminder window.
  function dueReminders(subs, today) {
    const out = [];
    for (const sub of subs) {
      const next = nextCharge(sub, today);
      if (!next) {
        continue;
      }
      const days = daysBetween(today, next);
      const window = Number.isFinite(Number(sub.reminderDays)) ? Number(sub.reminderDays) : 3;
      if (days <= window) {
        out.push({ sub, date: next, days });
      }
    }
    return out.toSorted((a, b) => a.days - b.days);
  }

  const api = {
    CYCLES,
    parseISO,
    toISO,
    startOfDay,
    daysInMonth,
    daysBetween,
    occurrence,
    chargesInRange,
    chargesInMonth,
    nextCharge,
    lastCharge,
    yearlyCost,
    monthlyEquivalent,
    monthSummary,
    dueReminders,
  };
  root.SubSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
