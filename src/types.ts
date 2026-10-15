export type Category = 'Attraction' | 'Restaurant' | 'Accommodation' | 'Parking' | 'Airport' | 'Transport' | 'Other';
export type Destination = {
  id: string; name: string; category: Category; address: string; date: string; time: string;
  duration: number; notes: string; priority: 'Must visit' | 'Optional' | 'Backup'; sortOrder?: number;
  lat: number | null; lng: number | null; price: number; visited: boolean;
};
export type Trip = { id: string; name: string; city: string; start: string; end: string; description: string; destinations: Destination[] };
export type BookingKind = 'Flight' | 'Accommodation' | 'Ticket' | 'Activity' | 'Restaurant' | 'Transfer' | 'Transport' | 'Parking' | 'Other';
export type BookingStatus = 'planned' | 'confirmed' | 'cancelled' | 'completed';
export type FlightDetails = { airline: string; flightNumber: string; departureAirport: string; arrivalAirport: string; departureAt: string; arrivalAt: string };
export type AccommodationDetails = { propertyName: string; checkInAt: string; checkOutAt: string; address: string };
export type Booking = {
  id: string; kind: BookingKind; title: string; date: string; time: string; reference: string; address: string;
  price: number; currency: string; notes: string; provider: string; bookingUrl: string; status: BookingStatus;
  flight?: FlightDetails; accommodation?: AccommodationDetails;
};
export type Expense = {
  id: string; category: string; title: string; amount: number; currency: string; date: string; notes: string;
  bookingId: string | null; destinationId: string | null;
};
export type TravelDocument = {
  id: string; tripId: string; bookingId: string | null; uploadedBy: string; storagePath: string;
  fileName: string; mimeType: string; sizeBytes: number; createdAt: string;
};

export type TripDraft = Omit<Trip, 'id' | 'destinations'> & { clientId?: string };
export type DestinationDraft = Omit<Destination, 'id' | 'visited'> & { visited?: boolean; clientId?: string };
export type BookingDraft = Omit<Booking, 'id'> & { clientId?: string };
export type ExpenseDraft = Omit<Expense, 'id'>;
