import { create } from 'zustand';

/**
 * Venue selection state store.
 * 
 * Stores the currently selected venue ID for venue-scoped operations.
 * 
 * Requirements: 10.9, 10.10, 10.11
 */
interface VenueState {
  selectedVenueId: string | null;
  
  setSelectedVenue: (venueId: string) => void;
  clearSelectedVenue: () => void;
}

/**
 * Zustand store for venue selection state.
 */
export const useVenueStore = create<VenueState>((set) => ({
  selectedVenueId: null,
  
  setSelectedVenue: (venueId) => set({ selectedVenueId: venueId }),
  clearSelectedVenue: () => set({ selectedVenueId: null }),
}));
