import { describe, expect, it } from 'vitest';
import type { Destination } from '../types';
import { itineraryDates, moveWithinDay, sortItineraryDestinations } from './itinerary';

const place = (id: string, date: string, sortOrder?: number, time = ''): Destination => ({
  id, name: id, category: 'Attraction', address: '', date, time, duration: 60, notes: '', priority: 'Optional',
  lat: 0, lng: 0, price: 0, visited: false, sortOrder,
});

describe('itinerary scheduling', () => {
  it('includes each trip date, including empty days and separately assigned dates', () => {
    expect(itineraryDates('2026-07-01', '2026-07-03', [place('outside', '2026-07-05')]))
      .toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05']);
  });

  it('sorts dated stops by stored sequence before time', () => {
    expect(sortItineraryDestinations([place('late', '2026-07-01', 1, '09:00'), place('first', '2026-07-01', 0, '12:00')])
      .map(item => item.id)).toEqual(['first', 'late']);
  });

  it('moves a stop only within its day and returns updated sequence values', () => {
    const moved = moveWithinDay([place('a', '2026-07-01', 0), place('b', '2026-07-01', 1), place('c', '2026-07-02', 0)], 'b', -1);
    expect(moved.map(item => [item.id, item.sortOrder])).toEqual([['b', 0], ['a', 1], ['c', 0]]);
    expect(moveWithinDay(moved, 'b', -1).map(item => item.id)).toEqual(['b', 'a', 'c']);
  });
});
