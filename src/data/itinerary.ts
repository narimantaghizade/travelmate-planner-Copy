import type { Destination } from '../types';

export function sortItineraryDestinations(destinations: Destination[]): Destination[] {
  return [...destinations].sort((a, b) => {
    const day = (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
    if (day) return day;
    const order = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
    return order || (a.time || '').localeCompare(b.time || '') || a.name.localeCompare(b.name);
  });
}

export function itineraryDates(start: string, end: string, destinations: Destination[]): string[] {
  const dates = new Set(destinations.map(item => item.date).filter(Boolean));
  if (start && end && start <= end) {
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cursor <= last) {
      dates.add(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else if (start) dates.add(start);
  else if (end) dates.add(end);
  return [...dates].sort();
}

export function moveWithinDay(destinations: Destination[], id: string, offset: -1 | 1): Destination[] {
  const ordered = sortItineraryDestinations(destinations);
  const index = ordered.findIndex(item => item.id === id);
  const next = index + offset;
  if (index < 0 || next < 0 || next >= ordered.length || ordered[index].date !== ordered[next].date) return ordered;
  [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
  const dayOrder = new Map<string, number>();
  return ordered.map(item => {
    const sortOrder = dayOrder.get(item.date) ?? 0;
    dayOrder.set(item.date, sortOrder + 1);
    return { ...item, sortOrder };
  });
}
