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

const DAY_HEADER = /^\s*day\s+(\d+)\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*:\s*(.*)$/i;
const TIME = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i;

function dateForDay(startDate: string, dayNumber: number, explicitDate?: string): string {
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    const parsed = new Date(`${explicitDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === explicitDate) return explicitDate;
  }
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

/** Parse day headers and comma/semicolon-separated notes into editable drafts. */
export function parseItineraryText(text: string, tripStartDate = ''): ItineraryImportDraft[] {
  const result: ItineraryImportDraft[] = [];
  let currentDay = 1;
  let currentDate: string | undefined;
  let sawHeader = false;

  for (const sourceLine of text.split(/\r?\n/)) {
    let line = sourceLine;
    const header = line.match(DAY_HEADER);
    if (header) {
      currentDay = Number(header[1]);
      currentDate = header[2];
      sawHeader = true;
      line = header[3];
    } else if (!sawHeader && !line.trim()) {
      continue;
    } else if (!sawHeader && line.trim()) {
      // Notes without an explicit day remain unscheduled instead of guessing.
      currentDay = 0;
    }

    for (const rawItem of line.split(/[;,|]/)) {
      const source = rawItem.trim().replace(/^[-•*]\s*/, '');
      if (!source) continue;
      const match = source.match(TIME);
      const time = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
      const name = (match ? source.replace(match[0], '') : source).replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
      if (!name) continue;
      result.push({
        name,
        date: currentDay > 0 ? dateForDay(tripStartDate, currentDay, currentDate) : '',
        time,
        address: '',
        notes: '',
        category: 'Other',
        dayNumber: currentDay,
      });
    }
  }
  return result;
}
