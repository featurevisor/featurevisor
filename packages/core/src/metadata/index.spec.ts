import {
  getDeadlineClock,
  getDeadlineLabel,
  getDeadlineStatus,
  getDeadlineStatuses,
  getDaysUntilDeadline,
  assertNowOption,
  getOwners,
  isCalendarDate,
  isDeadlineTimestamp,
  isDeadlineType,
  matchesDeadlineFilters,
} from ".";

// Midday in UTC is 15 January in every usual timezone, so these read the same wherever they run
const today = getDeadlineClock("2027-01-15T12:00:00Z");
const at = (date: string, time = "12:00:00") => `${date}T${time}Z`;

describe("deadline statuses", () => {
  it.each([
    [{ by: at("2027-01-14") }, "overdue"],
    [{ by: at("2027-01-15", "11:00:00") }, "overdue"],
    [{ by: at("2027-01-15", "12:30:00") }, "today"],
    [{ by: at("2027-01-16") }, "upcoming"],
    [{ by: at("2027-02-14") }, "upcoming"],
    [{ by: at("2027-02-15") }, "later"],
    [{ by: at("2026-01-01"), done: true }, "done"],
    [{ by: at("2026-01-01"), done: at("2026-02-01") }, "done"],
    [{ by: at("2026-01-01"), done: false }, "overdue"],
    [{ by: "2027-01-20" }, undefined],
    [{ by: "2027-01-20T12:00:00" }, undefined],
    [{ by: "soon" }, undefined],
  ])("%j is %s at midday on 15 January", (deadline, status) => {
    expect(getDeadlineStatus(deadline, today)).toBe(status);
  });

  it("is overdue from its moment, and due today until then on its local date", () => {
    const noon = new Date(2027, 0, 15, 12).getTime();
    const clock = getDeadlineClock(undefined, noon);
    expect(clock).toEqual({ now: noon, today: "2027-01-15" });
    const local = (hour: number) => new Date(2027, 0, 15, hour).toISOString();
    expect(getDeadlineStatus({ by: local(11) }, clock)).toBe("overdue");
    expect(getDeadlineStatus({ by: local(12) }, clock)).toBe("overdue");
    expect(getDeadlineStatus({ by: local(13) }, clock)).toBe("today");
  });

  it("reads a fixed clock from a timestamp with any offset", () => {
    const clock = getDeadlineClock("2027-01-15T13:00:00+01:00");
    expect(clock.now).toBe(Date.parse("2027-01-15T12:00:00Z"));
    expect(clock.today).toBe("2027-01-15");
  });

  it("counts days to the local date a deadline is due", () => {
    expect(getDaysUntilDeadline(at("2027-01-25"), today)).toBe(10);
    expect(getDaysUntilDeadline(at("2027-01-05"), today)).toBe(-10);
    expect(getDaysUntilDeadline(at("2028-01-15"), today)).toBe(365);
    expect(getDaysUntilDeadline("2027-01-25", today)).toBeUndefined();
    expect(getDaysUntilDeadline("never", today)).toBeUndefined();
  });
});

describe("deadline timestamps", () => {
  it("accepts ISO 8601 timestamps with a timezone, as conditions do", () => {
    for (const value of [
      "2027-03-01T09:00:00Z",
      "2027-03-01T09:00:00+01:00",
      "2027-03-01T09:00:00.123Z",
      "2028-02-29T23:59:59-05:30",
    ]) {
      expect(isDeadlineTimestamp(value)).toBe(true);
    }
    for (const value of [
      "2027-03-01",
      "2027-03-01T09:00:00",
      "2027-03-01T09:00Z",
      "2027-02-29T09:00:00Z",
      "2027-03-01 09:00:00Z",
      1767225600000,
    ]) {
      expect(isDeadlineTimestamp(value)).toBe(false);
    }
  });

  it("says what a --now value needs", () => {
    expect(() => assertNowOption("2027-03-01T09:00:00Z")).not.toThrow();
    expect(() => assertNowOption(undefined)).not.toThrow();
    expect(() => assertNowOption("2027-03-02")).toThrow(
      'Invalid --now: "2027-03-02". Expected a timestamp with a timezone, such as 2027-03-02T09:00:00Z. A date alone has no time or timezone.',
    );
    expect(() => assertNowOption("tomorrow")).toThrow(
      'Invalid --now: "tomorrow". Expected a timestamp with a timezone, such as 2027-01-15T09:00:00Z. Use YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm.',
    );
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
      review: { by: "2027-01-01T12:00:00Z", done: "2026-12-30T16:00:00Z" },
      remove: { by: "2027-01-20T12:00:00Z", ticket: "X-1" },
      notify: { by: "2026-12-01T12:00:00Z" },
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
    // in any case, as in Catalog
    [["Overdue"], true],
    [["REMOVE", "Upcoming"], true],
    [["Remove", "OVERDUE"], false],
  ])("%j matches: %s", (values, matches) => {
    expect(matchesDeadlineFilters(metadata, values, today)).toBe(matches);
  });

  it("lists each deadline with its status", () => {
    expect(getDeadlineStatuses(metadata, today)).toEqual([
      { type: "review", by: "2027-01-01T12:00:00Z", status: "done" },
      { type: "remove", by: "2027-01-20T12:00:00Z", status: "upcoming" },
      { type: "notify", by: "2026-12-01T12:00:00Z", status: "overdue" },
    ]);
  });
});
