import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authSlice';
import { useVenueStore } from '../store/venueSlice';
import { MainLayout } from '../layouts/MainLayout';
import { useEffect } from 'react';
import { apiClient } from '../lib/api';

export const ProtectedRoute = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { setVenues, setCurrentVenue, currentVenueId, venues } = useVenueStore();

  useEffect(() => {
    // Fetch venues from API when user is authenticated
    if (isAuthenticated) {
      apiClient.get('/venues')
        .then(response => {
          const fetchedVenues = response.data;
          setVenues(fetchedVenues);
          
          // If no venue is currently selected but venues exist, select the first one
          if (!currentVenueId && fetchedVenues.length > 0) {
            setCurrentVenue(fetchedVenues[0].id);
          }
        })
        .catch(error => {
          console.error('Failed to fetch venues:', error);
        });
    }
  }, [isAuthenticated, setVenues, setCurrentVenue, currentVenueId]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <MainLayout />;
};
