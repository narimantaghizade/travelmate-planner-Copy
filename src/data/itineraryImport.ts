import type { Category } from '../types';

export type ItineraryImportDraft = {
  name: string;
  date: string;
  time: string;
  address: string;
  notes: string;
  category: Category;
  dayNumber: number;
};

const DAY_HEADER = /^\s*day\s+(\d+)\b\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*:\s*(.*)$/i;
const TIME_PREFIX = /^\s*(?:[-•*]\s*)?((?:[01]?\d|2[0-3])):([0-5]\d)\s*(?:[-–—:]\s*)?(.*?)\s*$/;
const TIME_ANYWHERE = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i;
const DATE_ONLY = /^\s*(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*,?\s*)?(\d{1,2})\s+([\p{L}]+)\s+(\d{4})\s*[,.;]?\s*$/iu;
const ISO_DATE_ONLY = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;
const ADDRESS_PREFIX = /^\s*(?:address|adresse|location|lieu)\s*:\s*(.*)$/i;
const NOTES_PREFIX = /^\s*(?:additional\s+)?(?:personal\s+)?(?:notes?|tips?)\s*:\s*(.*)$/i;
const STREET_ADDRESS = /\b\d+[\w/-]*\s+[^,]*(?:rue|street|st\.?|avenue|ave\.?|boulevard|blvd\.?|place|road|rd\.?|impasse|allée|allee|quai|cours|square)\b/i;
const POSTAL_CODE = /\b\d{4,6}\s+[\p{L}][\p{L}'’-]*(?:\s+[^,]+)?$/iu;
const STREET_NAME = /\b(?:rue|avenue|boulevard|place|road|impasse|allée|allee|quai|cours|square)\s+[^,;—–]+/i;
const ACTIVITY_CUE = /\b(?:photo(?:booth)?|photos?|vid(?:eo|eos?)|selfie|sightseeing|shopping|visit|visite|priority|stop|grave|tomb|museum|musée|café|restaurant|lunch|dinner)\b/i;

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1,
  february: 2, feb: 2, février: 2, fevrier: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7,
  august: 8, aug: 8, août: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, décembre: 12, decembre: 12,
};

function validDate(year: number, month: number, day: number): string {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value.toISOString().slice(0, 10)
    : '';
}

function parseDateOnly(line: string): string | null {
  const iso = line.match(ISO_DATE_ONLY);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) || null;
  const named = line.match(DATE_ONLY);
  if (!named) return null;
  const month = MONTHS[named[2].toLocaleLowerCase('fr')]
    ?? MONTHS[named[2].toLocaleLowerCase('en')];
  return month ? validDate(Number(named[3]), month, Number(named[1])) || null : null;
}

function dateForDay(startDate: string, dayNumber: number): string {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
  const start = parseDateOnly(startDate);
  if (!start) return '';
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

function splitStops(line: string): string[] {
  // Split explicit bullet/numbered items and repeated time-led stops, never on
  // commas, which commonly separate a place name from its street address.
  const bullets = line.split(/\s+(?=[•●▪]\s*|\d+[.)]\s+)/).map(item => item.replace(/^\s*(?:[•●▪]|\d+[.)])\s*/, ''));
  const result: string[] = [];
  for (const bullet of bullets) {
    const starts = [...bullet.matchAll(/(?:^|\s)(\d{1,2}:\d{2}\s*[—–-]\s*)/g)];
    if (starts.length < 2) {
      const timedCommaItems = bullet.split(/,\s*(?=[^,]*\b(?:at\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b)/i);
      result.push(...timedCommaItems.flatMap(item => item.split(/\s*;\s*/)).map(item => item.trim()));
      continue;
    }
    for (let index = 0; index < starts.length; index++) {
      const start = starts[index].index! + starts[index][0].indexOf(starts[index][1]);
      const next = starts[index + 1];
      const end = next ? next.index! + next[0].indexOf(next[1]) : bullet.length;
      result.push(bullet.slice(start, end).trim());
    }
  }
  return result.filter(Boolean);
}

function extractAddress(name: string): { name: string; address: string } {
  const segments = name.split(/,\s*/);
  const addressIndex = segments.findIndex((segment, index) => index > 0 && (STREET_ADDRESS.test(segment) || /^\d{4,6}\s/.test(segment)));
  if (addressIndex < 0) return { name: name.trim(), address: '' };
  const addressParts = segments.splice(addressIndex);
  return { name: segments.join(', ').trim(), address: addressParts.join(', ').trim() };
}

function isAddressContinuation(line: string): boolean {
  if (TIME_PREFIX.test(line) || ACTIVITY_CUE.test(line) || /\s+[—–]\s+/.test(line)) return false;
  return STREET_ADDRESS.test(line) || POSTAL_CODE.test(line) || /^\s*(?:rue|avenue|boulevard|place|road|impasse|allée|allee|quai|cours|square)\b/i.test(line);
}

function splitDescription(source: string): { title: string; notes: string } {
  const separator = source.search(/\s+[—–]\s+/);
  if (separator < 0) return { title: source.trim(), notes: '' };
  const title = source.slice(0, separator).trim();
  const description = source.slice(separator).replace(/^\s+[—–]\s+/, '').trim();
  return ACTIVITY_CUE.test(description)
    ? { title, notes: description }
    : { title: source.trim(), notes: '' };
}

function extractAddressFromTitle(title: string): { name: string; address: string } {
  const numbered = title.match(/\b\d+[\w/-]*\s+[^,;—–]*(?:rue|street|st\.?|avenue|ave\.?|boulevard|blvd\.?|place|road|rd\.?|impasse|allée|allee|quai|cours|square)\b[^,;—–]*/i);
  const street = numbered ?? title.match(STREET_NAME);
  if (!street) return extractAddress(title);

  const addressStart = street.index ?? 0;
  const addressEnd = addressStart + street[0].length;
  let address = street[0].trim();
  const trailing = title.slice(addressEnd);
  const postal = trailing.match(/^,?\s*\d{4,6}\s+[^,;—–]+/);
  if (postal) address += `, ${postal[0].replace(/^,?\s*/, '').trim()}`;
  const before = title.slice(0, addressStart).replace(/\b(?:at|on|to)\s*$/i, '').replace(/[,;]\s*$/, '').trim();
  const after = title.slice(addressEnd + (postal?.[0].length ?? 0)).trim();
  const activityName = [before, after].filter(Boolean).join(' ').trim();
  return { name: activityName || street[0].trim(), address };
}

/**
 * Parse a manually reviewable itinerary. Day/date headings are metadata;
 * comma-separated text is preserved unless it clearly begins an address.
 */
export function parseItineraryText(text: string, tripStartDate = ''): ItineraryImportDraft[] {
  const result: ItineraryImportDraft[] = [];
  let currentDay = 0;
  let currentDate = '';

  const addActivity = (raw: string) => {
    let source = raw.trim().replace(/^[-•*]\s*/, '');
    if (!source) return;
    let time = '';
    const leadingTime = source.match(TIME_PREFIX);
    if (leadingTime) {
      time = `${leadingTime[1].padStart(2, '0')}:${leadingTime[2]}`;
      source = leadingTime[3].trim();
    } else {
      const timeMatch = source.match(TIME_ANYWHERE);
      if (timeMatch) {
        time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        source = source.replace(timeMatch[0], '').replace(/\s+/g, ' ').replace(/\s+([.,;!?])/g, '$1').trim();
      }
    }
    if (!source) return;
    const { title, notes } = splitDescription(source.trim());
    const { name, address } = extractAddressFromTitle(title);
    if (!name) return;
    const containsUnparsedNote = title === source.trim() && /\s+[—–]\s+/.test(title);
    const cleanName = containsUnparsedNote ? name : name.replace(/[.,;]+$/, '').trim();
    if (!cleanName) return;
    result.push({ name: cleanName, date: currentDate, time, address, notes, category: 'Other', dayNumber: currentDay });
  };

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;

    const header = line.match(DAY_HEADER);
    if (header) {
      currentDay = Number(header[1]);
      currentDate = dateForDay(tripStartDate, currentDay);
      const explicitHeaderDate = header[2] ? parseDateOnly(header[2]) : null;
      if (explicitHeaderDate) currentDate = explicitHeaderDate;
      const metadata = header[3] ?? '';
      const dateInHeader = parseDateOnly(metadata.replace(/^.*?[—–-]\s*/, ''))
        ?? parseDateOnly(metadata);
      if (dateInHeader) currentDate = dateInHeader;
      if (dateInHeader || /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(metadata)) continue;
      for (const stop of splitStops(metadata)) addActivity(stop);
      continue;
    }

    const date = parseDateOnly(line);
    if (date) {
      currentDate = date;
      continue;
    }

    const address = line.match(ADDRESS_PREFIX);
    if (address) {
      const previous = result.at(-1);
      if (previous && previous.dayNumber === currentDay && !previous.address) previous.address = address[1].trim();
      else addActivity(address[1]);
      continue;
    }

    const note = line.match(NOTES_PREFIX);
    if (note) {
      const previous = result.at(-1);
      if (previous && previous.dayNumber === currentDay) previous.notes = [previous.notes, note[1].trim()].filter(Boolean).join('\n');
      else addActivity(note[1]);
      continue;
    }

    if (isAddressContinuation(line)) {
      const previous = result.at(-1);
      if (previous && previous.dayNumber === currentDay && !previous.address) previous.address = line;
      else addActivity(line);
      continue;
    }

    for (const stop of splitStops(line)) addActivity(stop);
  }
  return result;
}
