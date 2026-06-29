// Builds a valid RFC-5545 .ics (VEVENT) from a schedule_event payload and downloads
// it. A real calendar artifact that imports into any calendar app — zero OAuth.

export interface IcsEvent {
  title: string;
  start: string; // ISO datetime (schedule_event.proposedStart)
  durationMinutes?: number;
  notes?: string;
  location?: string;
}

// Format a Date as the UTC basic form iCalendar expects: 20260628T140000Z
function fmtUTC(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Escape text per RFC 5545 (commas, semicolons, backslashes, newlines).
function esc(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcs(ev: IcsEvent): string {
  const startDate = new Date(ev.start);
  const validStart = isNaN(startDate.getTime()) ? new Date() : startDate;
  const endDate = new Date(validStart.getTime() + (ev.durationMinutes || 60) * 60 * 1000);
  const uid = `momentum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@momentum.app`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Momentum//Task Companion//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmtUTC(new Date())}`,
    `DTSTART:${fmtUTC(validStart)}`,
    `DTEND:${fmtUTC(endDate)}`,
    `SUMMARY:${esc(ev.title || "Event")}`,
    ev.notes ? `DESCRIPTION:${esc(ev.notes)}` : "",
    ev.location ? `LOCATION:${esc(ev.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}

export function downloadIcs(ev: IcsEvent): void {
  const content = buildIcs(ev);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (ev.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) + ".ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
