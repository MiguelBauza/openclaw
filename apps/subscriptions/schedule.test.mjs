// Run with: node --test apps/subscriptions/schedule.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const file of ["schedule.js", "ics.js"]) {
  vm.runInContext(readFileSync(new URL(file, import.meta.url), "utf8"), ctx);
}
const S = ctx.SubSchedule;
const Ics = ctx.SubIcs;
const d = (iso) => S.parseISO(iso);
const iso = (date) => (date ? S.toISO(date) : null);

test("monthly next charge, including a charge due today", () => {
  const sub = { startDate: "2026-01-15", cycle: "monthly" };
  assert.equal(iso(S.nextCharge(sub, d("2026-10-10"))), "2026-10-15");
  assert.equal(iso(S.nextCharge(sub, d("2026-10-15"))), "2026-10-15");
  assert.equal(iso(S.nextCharge(sub, d("2026-10-16"))), "2026-11-15");
  assert.equal(iso(S.lastCharge(sub, d("2026-10-10"))), "2026-09-15");
});

test("day 31 clamps to month end without drifting", () => {
  const sub = { startDate: "2026-01-31", cycle: "monthly" };
  assert.equal(iso(S.nextCharge(sub, d("2026-02-01"))), "2026-02-28");
  assert.equal(iso(S.nextCharge(sub, d("2026-03-01"))), "2026-03-31");
  assert.equal(iso(S.nextCharge(sub, d("2028-02-01"))), "2028-02-29");
});

test("future start date has no earlier charges", () => {
  const sub = { startDate: "2026-12-01", cycle: "monthly" };
  assert.equal(iso(S.nextCharge(sub, d("2026-10-10"))), "2026-12-01");
  assert.equal(S.chargesInMonth(sub, 2026, 9).length, 0);
});

test("yearly, quarterly and weekly cycles", () => {
  assert.equal(
    iso(S.nextCharge({ startDate: "2024-03-05", cycle: "yearly" }, d("2026-10-10"))),
    "2027-03-05",
  );
  assert.equal(
    iso(S.nextCharge({ startDate: "2026-01-20", cycle: "quarterly" }, d("2026-10-10"))),
    "2026-10-20",
  );
  const weekly = { startDate: "2026-10-02", cycle: "weekly" };
  assert.deepEqual([...S.chargesInMonth(weekly, 2026, 9)].map(iso), [
    "2026-10-02",
    "2026-10-09",
    "2026-10-16",
    "2026-10-23",
    "2026-10-30",
  ]);
});

test("end date and inactive subscriptions stop charges", () => {
  const ended = { startDate: "2026-01-10", cycle: "monthly", endDate: "2026-09-30" };
  assert.equal(S.nextCharge(ended, d("2026-10-01")), null);
  assert.equal(S.nextCharge({ startDate: "2026-01-10", active: false }, d("2026-10-01")), null);
});

test("month summary splits paid vs pending around today", () => {
  const subs = [
    { name: "A", price: 10, startDate: "2026-01-05", cycle: "monthly" },
    { name: "B", price: 5.5, startDate: "2026-01-10", cycle: "monthly" },
    { name: "C", price: 20, startDate: "2026-02-25", cycle: "monthly" },
    { name: "D", price: 99, startDate: "2025-03-01", cycle: "yearly" },
  ];
  const sum = S.monthSummary(subs, d("2026-10-10"));
  assert.equal(sum.paidTotal, 15.5);
  assert.equal(sum.pendingTotal, 20);
  assert.equal(sum.total, 35.5);
  assert.deepEqual(
    [...sum.pending].map((c) => c.sub.name),
    ["C"],
  );
});

test("reminders honour each subscription's window", () => {
  const subs = [
    { id: "a", name: "A", startDate: "2026-01-12", cycle: "monthly", reminderDays: 3 },
    { id: "b", name: "B", startDate: "2026-01-20", cycle: "monthly", reminderDays: 3 },
  ];
  const due = S.dueReminders(subs, d("2026-10-10"));
  assert.deepEqual(
    [...due].map((r) => [r.sub.id, r.days]),
    [["a", 2]],
  );
});

test("costs normalise to month and year", () => {
  assert.equal(S.yearlyCost({ price: 10, cycle: "monthly" }), 120);
  assert.equal(S.monthlyEquivalent({ price: 60, cycle: "yearly" }), 5);
});

test("ics rrule mirrors month-end clamping and alarms", () => {
  assert.equal(
    Ics.rrule({ startDate: "2026-01-15", cycle: "monthly" }),
    "FREQ=MONTHLY;BYMONTHDAY=15",
  );
  assert.equal(
    Ics.rrule({ startDate: "2026-01-30", cycle: "quarterly", endDate: "2027-01-01" }),
    "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=28,29,30;BYSETPOS=-1;UNTIL=20270101",
  );
  assert.equal(Ics.alarmTrigger(0), "PT9H");
  assert.equal(Ics.alarmTrigger(2), "-PT39H");
  const ics = Ics.buildIcs([
    { id: "x", name: "Net, flix", price: 9, startDate: "2026-01-15", cycle: "monthly" },
  ]);
  assert.match(ics, /SUMMARY:💳 Net\\, flix \(9\.00 EUR\)/);
  assert.match(ics, /DTEND;VALUE=DATE:20260116/);
});
