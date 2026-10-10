// iCalendar (.ics) export: one recurring all-day event per subscription with an
// alarm, so phone/desktop calendars can remind renewals even when the app is closed.
// Exposes `globalThis.SubIcs`. Depends on `globalThis.SubSchedule`.
(function (root) {
  "use strict";

  function icsEscape(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/([,;])/g, "\\$1");
  }

  function compactDate(iso) {
    return String(iso).replace(/-/g, "");
  }

  // RRULE that mirrors SubSchedule.occurrence(): days 29-31 fall back to the
  // last available day of shorter months via BYMONTHDAY list + BYSETPOS=-1.
  function rrule(sub) {
    const S = root.SubSchedule;
    const cycle = S.CYCLES[sub.cycle] || S.CYCLES.monthly;
    const parts = [];
    if (cycle.months === 0) {
      parts.push("FREQ=WEEKLY");
    } else {
      const day = S.parseISO(sub.startDate).getDate();
      parts.push("FREQ=MONTHLY");
      if (cycle.months > 1) {
        parts.push(`INTERVAL=${cycle.months}`);
      }
      if (day > 28) {
        const days = [];
        for (let d = 28; d <= day; d++) {
          days.push(d);
        }
        parts.push(`BYMONTHDAY=${days.join(",")}`, "BYSETPOS=-1");
      } else {
        parts.push(`BYMONTHDAY=${day}`);
      }
    }
    if (sub.endDate) {
      parts.push(`UNTIL=${compactDate(sub.endDate)}`);
    }
    return parts.join(";");
  }

  // Alarm at 09:00 local time, `reminderDays` days before the charge.
  function alarmTrigger(days) {
    const n = Math.max(0, Number(days) || 0);
    if (n === 0) {
      return "PT9H";
    }
    return `-PT${n * 24 - 9}H`;
  }

  function buildIcs(subs, options) {
    const currency = (options && options.currency) || "EUR";
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenClaw//Suscripciones//ES",
      "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:Suscripciones",
    ];
    for (const sub of subs) {
      if (sub.active === false || !sub.startDate) {
        continue;
      }
      const start = root.SubSchedule.parseISO(sub.startDate);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      const price = `${Number(sub.price || 0).toFixed(2)} ${currency}`;
      const summary = `💳 ${sub.name} (${price})`;
      const description = [sub.description, sub.paymentMethod && `Pago: ${sub.paymentMethod}`]
        .filter(Boolean)
        .join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${sub.id}@suscripciones.openclaw`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compactDate(sub.startDate)}`,
        `DTEND;VALUE=DATE:${compactDate(root.SubSchedule.toISO(end))}`,
        `RRULE:${rrule(sub)}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(`Renovación de ${sub.name}: ${price}`)}`,
        `TRIGGER:${alarmTrigger(sub.reminderDays)}`,
        "END:VALARM",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  root.SubIcs = { buildIcs, rrule, alarmTrigger };
})(typeof globalThis !== "undefined" ? globalThis : this);
