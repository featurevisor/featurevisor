import {
  getDeadlineClock,
  getDeadlineLabel,
  getDeadlineStatus,
  getDeadlineStatuses,
  getDaysUntilDeadline,
  getOwners,
  isCalendarDate,
  isDeadlineType,
  matchesDeadlineFilters,
} from ".";

const today = getDeadlineClock("2027-01-15");

describe("deadline statuses", () => {
  it.each([
    [{ by: "2027-01-14" }, "overdue"],
    [{ by: "2027-01-15" }, "today"],
    [{ by: "2027-01-16" }, "upcoming"],
    [{ by: "2027-02-14" }, "upcoming"],
    [{ by: "2027-02-15" }, "later"],
    [{ by: "2026-01-01", done: true }, "done"],
    [{ by: "2026-01-01", done: "2026-02-01" }, "done"],
    [{ by: "2026-01-01", done: false }, "overdue"],
    [{ by: "soon" }, undefined],
  ])("%j is %s on 15 January", (deadline, status) => {
    expect(getDeadlineStatus(deadline, today)).toBe(status);
  });

  it("counts a timestamp on its local date, and as overdue from its moment", () => {
    const noon = new Date(2027, 0, 15, 12).getTime();
    const clock = getDeadlineClock(undefined, noon);
    expect(clock.today).toBe("2027-01-15");
    const at = (hour: number) => new Date(2027, 0, 15, hour).toISOString();
    expect(getDeadlineStatus({ by: at(11) }, clock)).toBe("overdue");
    expect(getDeadlineStatus({ by: at(13) }, clock)).toBe("today");
    // a fixed date compares dates alone, so a report reads the same all day
    expect(getDeadlineStatus({ by: at(11) }, today)).toBe("today");
  });

  it("counts days to the date a deadline is due", () => {
    expect(getDaysUntilDeadline("2027-01-25", today)).toBe(10);
    expect(getDaysUntilDeadline("2027-01-05", today)).toBe(-10);
    expect(getDaysUntilDeadline("2028-01-15", today)).toBe(365);
    expect(getDaysUntilDeadline("never", today)).toBeUndefined();
  });
});

describe("deadline types and labels", () => {
  it.each([
    ["review", "Review"],
    ["deprecate", "Deprecate"],
    ["notifyCustomers", "Notify customers"],
    ["remove_code", "Remove code"],
    ["security-review", "Security review"],
    ["notifyAPIUsers", "Notify API users"],
    ["SSO", "SSO"],
  ])("%s reads %s", (type, label) => {
    expect(getDeadlineLabel(type)).toBe(label);
  });

  it("refuses status words and keys that do not start with a letter", () => {
    expect(isDeadlineType("review")).toBe(true);
    for (const key of ["done", "Overdue", "open", "1st", "a b", ""]) {
      expect(isDeadlineType(key)).toBe(false);
    }
  });

  it("knows real calendar dates", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2027-1-5")).toBe(false);
  });
});

describe("metadata filters", () => {
  const metadata = {
    owner: ["checkout-team", "payments-team"],
    deadlines: {
      review: { by: "2027-01-01", done: "2026-12-30" },
      remove: { by: "2027-01-20", ticket: "X-1" },
      notify: { by: "2026-12-01" },
    },
  };

  it("reads owners as a list", () => {
    expect(getOwners(metadata)).toEqual(["checkout-team", "payments-team"]);
    expect(getOwners({ owner: "growth-team" })).toEqual(["growth-team"]);
    expect(getOwners({})).toEqual([]);
    expect(getOwners(undefined)).toEqual([]);
  });

  it.each([
    [[], true],
    [["overdue"], true],
    [["done"], true],
    [["upcoming"], true],
    [["today"], false],
    [["later"], false],
    [["open"], true],
    [["remove"], true],
    [["cleanup"], false],
    [["remove", "upcoming"], true],
    // every value describes the same deadline
    [["remove", "overdue"], false],
    [["review", "done"], true],
    [["review", "remove"], false],
  ])("%j matches: %s", (values, matches) => {
    expect(matchesDeadlineFilters(metadata, values, today)).toBe(matches);
  });

  it("lists each deadline with its status", () => {
    expect(getDeadlineStatuses(metadata, today)).toEqual([
      { type: "review", by: "2027-01-01", status: "done" },
      { type: "remove", by: "2027-01-20", status: "upcoming" },
      { type: "notify", by: "2026-12-01", status: "overdue" },
    ]);
  });
});
