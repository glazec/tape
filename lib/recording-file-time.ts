/** A filename is a clue, never an authoritative recording clock. */
export type RecordingTimeClue = {
  localTime: string;
  source: "filename" | "modified";
  assumedYear: boolean;
};
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const pad = (n: number) => String(n).padStart(2, "0");

function validLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return false;
  const date = new Date(`${value}Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
  );
}

export function inferRecordingFileTime(
  file: { name: string; lastModified: number },
  now = new Date(),
): RecordingTimeClue | null {
  const numeric = file.name.match(
    /(?:^|[^\d])(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[ T_-]+([0-2]\d)[.:-]?([0-5]\d)(?:[.:-]?([0-5]\d))?(?!\d)/,
  );
  if (numeric) {
    const [, y, m, d, h, min, sec] = numeric;
    const localTime = `${y}-${m}-${d}T${h}:${min}${sec ? `:${sec}` : ""}`;
    if (validLocal(localTime))
      return { localTime, source: "filename", assumedYear: false };
  }
  const named = file.name.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\s+(?:at\s+)?(\d{1,2})[-:.](\d{2})\s*(AM|PM)\b/i,
  );
  if (named) {
    const [, month, day, year, hour, minute, ampm] = named;
    let y = year ? Number(year) : now.getFullYear();
    const m = months.indexOf(month.slice(0, 3).toLowerCase()) + 1;
    if (Number(hour) >= 1 && Number(hour) <= 12) {
      const h = (Number(hour) % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
      const build = () =>
        `${y}-${pad(m)}-${pad(Number(day))}T${pad(h)}:${minute}`;
      // Most imports are historical. A missing year is still explicitly disclosed.
      if (!year && new Date(`${build()}Z`).getTime() > now.getTime() + 86400000)
        y -= 1;
      const localTime = build();
      if (validLocal(localTime))
        return { localTime, source: "filename", assumedYear: !year };
    }
  }
  if (file.lastModified > 0 && Number.isFinite(file.lastModified)) {
    const date = new Date(file.lastModified);
    if (Number.isFinite(date.getTime()))
      return {
        localTime: timeInZone(
          date.toISOString(),
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
        source: "modified",
        assumedYear: false,
      };
  }
  return null;
}

function fixedOffset(zone: string): number | null {
  if (zone === "UTC") return 0;
  const match = zone.match(/^UTC([+-])(\d{2}):(\d{2})$/);
  if (
    !match ||
    Number(match[2]) > 14 ||
    Number(match[3]) > 59 ||
    (Number(match[2]) === 14 && Number(match[3]) !== 0)
  )
    return null;
  return (
    (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1)
  );
}

export function timeInZone(iso: string, zone: string): string {
  const offset = fixedOffset(zone);
  if (offset !== null)
    return new Date(Date.parse(iso) + offset * 60000)
      .toISOString()
      .slice(0, 19);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export function localTimeToIso(
  value: string,
  zone: string,
): { iso?: string; error?: string } {
  if (!validLocal(value))
    return { error: "Enter a valid recording date and time." };
  const wallTime = Date.parse(`${value}Z`);
  const offset = fixedOffset(zone);
  if (offset !== null)
    return { iso: new Date(wallTime - offset * 60000).toISOString() };
  try {
    // Collect offsets on both sides of a transition, then round-trip the local time.
    const offsets = new Set<number>();
    for (const delta of [-36, -12, 0, 12, 36]) {
      const instant = wallTime + delta * 3600000;
      offsets.add(
        Date.parse(`${timeInZone(new Date(instant).toISOString(), zone)}Z`) -
          instant,
      );
    }
    const normalized = value.length === 16 ? `${value}:00` : value;
    const matches = [...offsets]
      .map((o) => new Date(wallTime - o).toISOString())
      .filter((iso) => timeInZone(iso, zone) === normalized);
    if (!matches.length)
      return {
        error:
          "This local time does not exist because the clocks change. Choose another time.",
      };
    if (matches.length > 1)
      return {
        error:
          "This local time occurs twice. Enter its UTC offset in Timezone, such as UTC-04:00 or UTC-05:00.",
      };
    return { iso: matches[0] };
  } catch {
    return {
      error: "Choose a valid timezone, such as America/New_York or UTC-04:00.",
    };
  }
}

export function parseMediaTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,3}):([0-5]\d)$/);
  if (!match || (match[1] !== undefined && Number(match[2]) >= 60)) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** Bounded MP4 atom reads skip media bytes; creation can also mean export/finalization. */
export async function readRecordingCreationTime(
  file: Blob,
): Promise<string | null> {
  let inspected = 0;
  async function scan(
    start: number,
    end: number,
    depth: number,
  ): Promise<string | null> {
    for (let at = start; at + 8 <= end && inspected++ < 128; ) {
      const bytes = await file.slice(at, Math.min(at + 40, end)).arrayBuffer();
      const view = new DataView(bytes);
      let size = view.getUint32(0);
      const type = new TextDecoder().decode(bytes.slice(4, 8));
      let header = 8;
      if (size === 1) {
        if (bytes.byteLength < 16) return null;
        size = Number(view.getBigUint64(8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > end)
        return null;
      if (type === "mvhd" && bytes.byteLength >= header + 12) {
        const version = view.getUint8(header);
        const seconds =
          version === 1
            ? Number(view.getBigUint64(header + 4))
            : version === 0
              ? view.getUint32(header + 4)
              : 0;
        const ms = (seconds - 2082844800) * 1000;
        if (ms >= Date.UTC(2000, 0, 1) && ms <= Date.now() + 86400000)
          return new Date(ms).toISOString();
      }
      if (type === "moov" && depth === 0) {
        const result = await scan(at + header, at + size, 1);
        if (result) return result;
      }
      at += size;
    }
    return null;
  }
  try {
    return await scan(0, file.size, 0);
  } catch {
    return null;
  }
}
