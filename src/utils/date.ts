/**
 * Returns the current date in Colombia's timezone (UTC-5) formatted as YYYY-MM-DD.
 * Colombia does not observe Daylight Saving Time (DST).
 */
export function getColombiaDate(): string {
  const d = new Date();
  // Adjust UTC time by subtracting 5 hours to get Colombia local time
  const colTime = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return colTime.toISOString().split("T")[0];
}

/**
 * Returns yesterday's date in Colombia's timezone (UTC-5) formatted as YYYY-MM-DD.
 */
export function getColombiaYesterdayDate(): string {
  const d = new Date();
  // Adjust UTC time by subtracting 5 hours (Colombia) and another 24 hours (yesterday)
  const colTime = new Date(d.getTime() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return colTime.toISOString().split("T")[0];
}
