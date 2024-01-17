export function prettyDuration(diffInMs) {
  let diff = Math.abs(diffInMs);

  const ms = diff % 1000;
  diff = (diff - ms) / 1000;
  const secs = diff % 60;
  diff = (diff - secs) / 60;
  const mins = diff % 60;
  const hrs = (diff - mins) / 60;

  let result = "";

  if (hrs) {
    result += ` ${hrs}h`;
  }

  if (mins) {
    result += ` ${mins}m`;
  }

  if (secs) {
    result += ` ${secs}s`;
  }

  if (ms) {
    result += ` ${ms}ms`;
  }

  return result.trim();
}
