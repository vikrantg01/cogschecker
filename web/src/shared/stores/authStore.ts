import { create } from 'zustand';
import { SubscriptionTier } from '../types/subscription';

/**
 * Authentication state store.
 * 
 * Stores JWT token, user info, and subscription tier from Cognito custom claims.
 * 
 * Requirements: 8.1-8.10, 11.2
 */
interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  organisationId: string | null;
  tier: SubscriptionTier | null;
  venueRoles: Record<string, 'admin' | 'manager' | 'staff'> | null;
  
  setAuth: (auth: {
    token: string;
    userId: string;
    email: string;
    organisationId: string;
    tier: SubscriptionTier;
    venueRoles: Record<string, 'admin' | 'manager' | 'staff'>;
  }) => void;
  
  clearAuth: () => void;
  
  isAuthenticated: () => boolean;
}

/**
 * Zustand store for authentication state.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  userId: null,
  email: null,
  organisationId: null,
  tier: null,
  venueRoles: null,
  
  setAuth: (auth) => set({
    token: auth.token,
    userId: auth.userId,
    email: auth.email,
    organisationId: auth.organisationId,
    tier: auth.tier,
    venueRoles: auth.venueRoles,
  }),
  
  clearAuth: () => set({
    token: null,
    userId: null,
    email: null,
    organisationId: null,
    tier: null,
    venueRoles: null,
  }),
  
  isAuthenticated: () => get().token !== null,
}));
