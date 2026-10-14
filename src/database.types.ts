export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type BookingKind = 'Flight' | 'Accommodation' | 'Ticket' | 'Activity' | 'Restaurant' | 'Transfer' | 'Transport' | 'Parking' | 'Other';
type BookingStatus = 'planned' | 'confirmed' | 'cancelled' | 'completed';

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      trips: Table<{
        id: string; owner_id: string; client_id: string | null; name: string; city: string;
        start_date: string | null; end_date: string | null; description: string; created_at: string; updated_at: string;
      }, {
        id?: string; owner_id: string; client_id?: string | null; name: string; city?: string;
        start_date?: string | null; end_date?: string | null; description?: string;
      }>;
      destinations: Table<{
        id: string; trip_id: string; client_id: string | null; name: string; category: string; address: string;
        planned_date: string | null; planned_time: string | null; duration_minutes: number; notes: string;
        priority: string; latitude: number | null; longitude: number | null; estimated_cost: number;
        visited: boolean; sort_order: number; created_at: string; updated_at: string;
      }, {
        id?: string; trip_id: string; client_id?: string | null; name: string; category?: string; address?: string;
        planned_date?: string | null; planned_time?: string | null; duration_minutes?: number; notes?: string;
        priority?: string; latitude?: number | null; longitude?: number | null; estimated_cost?: number;
        visited?: boolean; sort_order?: number;
      }>;
      bookings: Table<{
        id: string; trip_id: string; client_id: string | null; kind: BookingKind;
        title: string; booking_date: string | null; local_time: string | null; reference: string; address: string;
        estimated_cost: number; currency: string; notes: string; provider: string; booking_url: string; status: BookingStatus;
        created_at: string; updated_at: string;
      }, {
        id?: string; trip_id: string; client_id?: string | null; kind: BookingKind;
        title: string; booking_date?: string | null; local_time?: string | null; reference?: string; address?: string;
        estimated_cost?: number; currency?: string; notes?: string; provider?: string; booking_url?: string; status?: BookingStatus;
      }, {
        id?: string; trip_id?: string; client_id?: string | null; kind?: BookingKind; title?: string;
        booking_date?: string | null; local_time?: string | null; reference?: string; address?: string;
        estimated_cost?: number; currency?: string; notes?: string; provider?: string; booking_url?: string; status?: BookingStatus;
      }>;
      trip_members: Table<{ trip_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer'; created_at: string }>;
      itinerary_entries: Table<{ id: string; trip_id: string; destination_id: string | null; entry_date: string | null; starts_at: string | null; duration_minutes: number; title: string; notes: string; sort_order: number; created_at: string }>;
      flights: Table<{ id: string; trip_id: string; booking_id: string; airline: string; flight_number: string; departure_airport: string; arrival_airport: string; departure_at: string | null; arrival_at: string | null }>;
      accommodations: Table<{ id: string; trip_id: string; booking_id: string; property_name: string; check_in_at: string | null; check_out_at: string | null; address: string }>;
      expenses: Table<{
        id: string; trip_id: string; booking_id: string | null; destination_id: string | null;
        title: string; amount: number; currency: string; spent_on: string | null; notes: string;
        category: string; created_at: string;
      }, {
        id?: string; trip_id: string; booking_id?: string | null; destination_id?: string | null;
        title: string; amount: number; currency?: string; spent_on?: string | null; notes?: string;
        category?: string;
      }, {
        id?: string; trip_id?: string; booking_id?: string | null; destination_id?: string | null;
        title?: string; amount?: number; currency?: string; spent_on?: string | null; notes?: string;
        category?: string;
      }>;
      documents: Table<{
        id: string; trip_id: string; booking_id: string | null; uploaded_by: string; storage_path: string;
        file_name: string; mime_type: string; size_bytes: number; created_at: string;
      }, {
        id?: string; trip_id: string; booking_id?: string | null; uploaded_by: string; storage_path: string;
        file_name: string; mime_type: string; size_bytes: number; created_at?: string;
      }, {
        id?: string; trip_id?: string; booking_id?: string | null; uploaded_by?: string; storage_path?: string;
        file_name?: string; mime_type?: string; size_bytes?: number; created_at?: string;
      }>;
      profiles: Table<{ id: string; display_name: string | null; created_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      is_trip_member: { Args: { target_trip: string }; Returns: boolean };
      can_edit_trip: { Args: { target_trip: string }; Returns: boolean };
      is_trip_owner: { Args: { target_trip: string }; Returns: boolean };
      accept_trip_invitation: { Args: { invitation_token: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
