/** "4:30 PM" from minutes since midnight. */
export const fmtMin = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** "Due tomorrow", "2 days overdue"... from the number of days until the deadline. */
export const dueText = (dueIn: number | null) =>
  dueIn === null ? "No deadline" : dueIn < 0 ? `${-dueIn} day${dueIn === -1 ? "" : "s"} overdue` : dueIn === 0 ? "Due today" : dueIn === 1 ? "Due tomorrow" : `Due in ${dueIn} days`;
