import * as core from ".";

/**
 * Catalog cannot import Core, so it reads owners and deadlines with its own copy of this module.
 * Both must agree, or a list in Catalog and `featurevisor list` would disagree about a deadline.
 */
const catalog = require("../../../catalog/src/metadata");

const dates = [
  "2027-01-15",
  "2027-01-14",
  "2027-01-16",
  "2027-02-14",
  "2027-02-15",
  "2028-02-29",
  "2027-02-29",
  "0050-01-01",
  "2027-1-5",
  "2027-01-15T00:00:00Z",
  "2027-01-15T23:59:59+14:00",
  "2027-01-15T09:00:00.123456789-03:30",
  "2027-01-15T09:00:00",
  "2027-01-15T24:00:00Z",
  "2027-01-15T09:00:00+14:30",
  "soon",
  "",
];

const clocks = [
  { today: "2027-01-15" },
  { today: "2027-01-15", now: Date.parse("2027-01-15T12:00:00Z") },
  { today: "2026-12-31", now: Date.parse("2026-12-31T23:59:59Z") },
];

describe("Catalog reads metadata as Core does", () => {
  it.each(dates)("reads %j the same", (value) => {
    expect(catalog.isCalendarDate(value)).toBe(core.isCalendarDate(value));
    expect(catalog.getDeadlineTimestamp(value)).toBe(core.getDeadlineTimestamp(value));
    expect(catalog.getDeadlineDate(value)).toBe(core.getDeadlineDate(value));
    for (const clock of clocks) {
      for (const done of [undefined, true, false, "2027-01-10", ""]) {
        const deadline = { by: value, done };
        expect(catalog.getDeadlineStatus(deadline, clock)).toBe(
          core.getDeadlineStatus(deadline, clock),
        );
      }
      expect(catalog.getDaysUntilDeadline(value, clock)).toBe(
        core.getDaysUntilDeadline(value, clock),
      );
    }
  });

  it("names deadline types alike", () => {
    for (const type of [
      "review",
      "notifyCustomers",
      "remove_code",
      "security-review",
      "notifyAPIUsers",
      "SSO",
      "a",
    ]) {
      expect(catalog.getDeadlineLabel(type)).toBe(core.getDeadlineLabel(type));
    }
    expect(catalog.DEADLINE_STATUS_FILTERS).toEqual(core.DEADLINE_STATUS_FILTERS);
    expect(catalog.UPCOMING_DAYS).toBe(core.UPCOMING_DAYS);
  });

  it("reads owners and filters deadlines alike", () => {
    const metadata = {
      owner: ["checkout-team", "", 1, "payments-team"],
      deadlines: {
        review: { by: "2027-01-01", done: "2026-12-30" },
        remove: { by: "2027-01-20" },
        notify: { by: "2026-12-01" },
        broken: { done: true },
      },
    };
    expect(catalog.getOwners(metadata)).toEqual(core.getOwners(metadata));
    for (const owner of ["a", "", ["a", "b"], 1, undefined]) {
      expect(catalog.getOwners({ owner })).toEqual(core.getOwners({ owner }));
    }
    const filters = [
      [],
      ["overdue"],
      ["today"],
      ["upcoming"],
      ["later"],
      ["open"],
      ["done"],
      ["remove"],
      ["remove", "upcoming"],
      ["remove", "overdue"],
      ["review", "done"],
      ["review", "remove"],
    ];
    for (const values of filters) {
      expect(
        catalog.matchesDeadlineFilters(catalog.getDeadlines(metadata), values, clocks[0]),
      ).toBe(core.matchesDeadlineFilters(metadata, values, clocks[0]));
    }
  });
});
