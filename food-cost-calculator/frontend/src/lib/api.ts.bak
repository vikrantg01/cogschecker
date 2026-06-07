import axios from 'axios';
import { useAuthStore } from '../store/authSlice';
import { useVenueStore } from '../store/venueSlice';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to inject Authorization and X-Venue-ID headers
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    const venueId = useVenueStore.getState().currentVenueId;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (venueId) {
      config.headers['X-Venue-ID'] = venueId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 and 402 errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized - token expired
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) {
          useAuthStore.getState().clearAuth();
          window.location.href = '/login';
          return Promise.reject(error);
        }

        // Attempt to refresh token
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        const user = useAuthStore.getState().user;
        
        useAuthStore.getState().setAuth(accessToken, newRefreshToken, user);

        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Handle 402 Payment Required - subscription tier gate
    if (error.response?.status === 402) {
      // This will be handled by useSubscriptionGate hook in components
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);
