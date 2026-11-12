/**
 * Deadline statuses count calendar days in the reader's timezone, so every test reads them in
 * UTC, wherever it runs. Jest ignores a timezone set inside a test, so it is set here, before
 * any worker starts.
 */
module.exports = () => {
  process.env.TZ = "UTC";
};
