import { describe, expect, it } from 'vitest';
import {
  clearNavigationPreference, restoreNavigationPreference, saveNavigationPreference,
} from './navigationPreference';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe('navigation preference', () => {
  it('restores the selected trip and current section for the same user', () => {
    const storage = memoryStorage();
    saveNavigationPreference(storage, 'user-a', { tripId:'trip-2', section:'Expenses' });
    expect(restoreNavigationPreference(storage, 'user-a', [{ id:'trip-1' }, { id:'trip-2' }]))
      .toEqual({ tripId:'trip-2', section:'Expenses' });
  });

  it('falls back to a valid overview when the saved trip was deleted or is unauthorized', () => {
    const storage = memoryStorage();
    saveNavigationPreference(storage, 'user-a', { tripId:'private-trip', section:'Map Explorer' });
    expect(restoreNavigationPreference(storage, 'user-a', [{ id:'accessible-trip' }]))
      .toEqual({ tripId:'accessible-trip', section:'Overview' });
    expect(restoreNavigationPreference(storage, 'user-a', []))
      .toEqual({ tripId:'', section:'Overview' });
  });

  it('does not restore another user’s preference and clears it on sign-out', () => {
    const storage = memoryStorage();
    saveNavigationPreference(storage, 'user-a', { tripId:'trip-a', section:'Itinerary' });
    saveNavigationPreference(storage, 'user-b', { tripId:'trip-b', section:'Flights' });
    expect(restoreNavigationPreference(storage, 'user-b', [{ id:'trip-b' }]))
      .toEqual({ tripId:'trip-b', section:'Flights' });
    clearNavigationPreference(storage, 'user-a');
    expect(restoreNavigationPreference(storage, 'user-a', [{ id:'trip-a' }]))
      .toEqual({ tripId:'trip-a', section:'Overview' });
    expect(restoreNavigationPreference(storage, 'user-b', [{ id:'trip-b' }]))
      .toEqual({ tripId:'trip-b', section:'Flights' });
  });
});
