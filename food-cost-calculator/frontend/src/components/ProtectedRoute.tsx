import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authSlice';
import { useVenueStore } from '../store/venueSlice';
import { MainLayout } from '../layouts/MainLayout';
import { useEffect } from 'react';
import { apiClient } from '../lib/api';

// Helper function to decode JWT token
function decodeJWT(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

export const ProtectedRoute = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const token = useAuthStore((state) => state.token);
  const { setVenues, setCurrentVenue, currentVenueId } = useVenueStore();

  useEffect(() => {
    // Fetch venues from API when user is authenticated
    if (isAuthenticated && token) {
      // Decode JWT to get organisation ID
      const decoded = decodeJWT(token);
      const orgId = decoded?.['custom:org_id'] || decoded?.org_id || decoded?.organisationId;

      if (orgId) {
        apiClient.get(`/organisations/${orgId}/venues`)
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
      } else {
        console.error('No organisation ID found in JWT token');
      }
    }
  }, [isAuthenticated, token, setVenues, setCurrentVenue, currentVenueId]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <MainLayout />;
};
