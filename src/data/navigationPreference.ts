export const NAVIGATION_SECTIONS = [
  'Overview', 'Itinerary', 'Map Explorer', 'Destinations', 'Flights', 'Accommodation',
  'Tickets & bookings', 'Transport & parking', 'Documents', 'Expenses',
] as const;

export type NavigationSection = typeof NAVIGATION_SECTIONS[number];
export type NavigationPreference = { tripId: string; section: NavigationSection };
type TripReference = { id: string };

const STORAGE_PREFIX = 'travelmate-navigation-v1:';
const DEFAULT_PREFERENCE: NavigationPreference = { tripId: '', section: 'Overview' };

function preferenceKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

export function isNavigationSection(value: unknown): value is NavigationSection {
  return typeof value === 'string' && NAVIGATION_SECTIONS.some(section => section === value);
}

export function saveNavigationPreference(storage: Pick<Storage, 'setItem'>, scope: string, preference: NavigationPreference): void {
  if (!isNavigationSection(preference.section)) return;
  try {
    storage.setItem(preferenceKey(scope), JSON.stringify({ tripId: preference.tripId, section: preference.section }));
  } catch {
    // Navigation persistence is optional; storage may be disabled or full.
  }
}

export function restoreNavigationPreference(
  storage: Pick<Storage, 'getItem'>,
  scope: string,
  trips: TripReference[],
): NavigationPreference {
  const fallback = { ...DEFAULT_PREFERENCE, tripId: trips[0]?.id ?? '' };
  try {
    const raw = storage.getItem(preferenceKey(scope));
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<NavigationPreference>;
    if (typeof saved.tripId !== 'string' || !trips.some(trip => trip.id === saved.tripId) || !isNavigationSection(saved.section)) return fallback;
    return { tripId: saved.tripId, section: saved.section };
  } catch {
    return fallback;
  }
}

export function clearNavigationPreference(storage: Pick<Storage, 'removeItem'>, scope: string): void {
  try {
    storage.removeItem(preferenceKey(scope));
  } catch {
    // A failed cleanup cannot expose another account's preference because keys are user-scoped.
  }
}
