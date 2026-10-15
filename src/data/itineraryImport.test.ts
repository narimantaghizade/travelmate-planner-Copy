import { describe, expect, it } from 'vitest';
import { parseItineraryText } from './itineraryImport';

describe('pasted itinerary parsing', () => {
  it('splits day notes into editable items and assigns only implied date and time', () => {
    expect(parseItineraryText('Day 1: Arrive in Paris at 09:00, visit the Louvre at 14:00, dinner at 19:00.', '2026-10-15'))
      .toMatchObject([
        { name: 'Arrive in Paris', date: '2026-10-15', time: '09:00', category: 'Other', address: '', notes: '' },
        { name: 'visit the Louvre', date: '2026-10-15', time: '14:00' },
        { name: 'dinner', date: '2026-10-15', time: '19:00' },
      ]);
  });

  it('advances dates by day number and accepts explicit day dates', () => {
    const items = parseItineraryText('Day 2: Museum\nDay 3 (2026-10-20): Train', '2026-10-15');
    expect(items.map(item => item.date)).toEqual(['2026-10-16', '2026-10-20']);
  });

  it('does not invent a date for notes without a day or trip start', () => {
    expect(parseItineraryText('Pick up keys at 08:30')).toEqual([
      { name: 'Pick up keys', date: '', time: '08:30', address: '', notes: '', category: 'Other', dayNumber: 0 },
    ]);
  });
});
