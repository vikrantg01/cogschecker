import { useVenueStore } from '../store/venueSlice';

export const VenueSelector = () => {
  const { currentVenueId, venues, setCurrentVenue, getCurrentVenue } = useVenueStore();
  const currentVenue = getCurrentVenue();

  if (venues.length === 0) {
    return null;
  }

  return (
    <div className="venue-selector">
      <select
        value={currentVenueId || ''}
        onChange={(e) => setCurrentVenue(e.target.value)}
        className="block w-48 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
      >
        <option value="" disabled>
          Select a venue
        </option>
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.name}
          </option>
        ))}
      </select>
      {currentVenue && (
        <span className="ml-2 text-sm text-gray-600">
          {currentVenue.name}
        </span>
      )}
    </div>
  );
};
