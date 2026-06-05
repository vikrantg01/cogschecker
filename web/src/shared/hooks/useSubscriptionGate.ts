import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { SubscriptionTier, hasSufficientTier } from '../types/subscription';

/**
 * Hook for checking subscription tier access to features.
 * 
 * This hook provides client-side tier gating to show upgrade prompts before
 * making API calls. The backend SubscriptionGateFilter provides the authoritative
 * enforcement with HTTP 402 responses.
 * 
 * Requirements: 11.3 - Display upgrade prompt when accessing tier-gated features
 * 
 * @returns Object with tier checking utilities
 * 
 * @example
 * ```tsx
 * function InvoiceUploadButton() {
 *   const { requiresTier, userTier } = useSubscriptionGate();
 *   
 *   const handleClick = () => {
 *     if (!requiresTier('pro')) {
 *       // Show upgrade modal (handled by requiresTier return value)
 *       return;
 *     }
 *     // Proceed with upload
 *     uploadInvoice();
 *   };
 *   
 *   return (
 *     <button onClick={handleClick} disabled={userTier !== 'pro' && userTier !== 'pro_plus'}>
 *       Upload Invoice
 *     </button>
 *   );
 * }
 * ```
 */
export function useSubscriptionGate() {
  const tier = useAuthStore((state) => state.tier);
  
  /**
   * Check if the current user's tier meets the required tier level.
   * 
   * This performs a client-side check only. The backend SubscriptionGateFilter
   * provides the authoritative enforcement.
   * 
   * @param requiredTier The minimum tier required for the feature
   * @returns true if user has sufficient access, false otherwise
   */
  const hasAccess = useCallback(
    (requiredTier: SubscriptionTier): boolean => {
      return hasSufficientTier(tier, requiredTier);
    },
    [tier]
  );
  
  /**
   * Check tier access and return false if insufficient, triggering upgrade flow.
   * 
   * Usage pattern:
   * ```tsx
   * if (!requiresTier('pro')) {
   *   return; // User will see upgrade prompt via UpgradeModal
   * }
   * // Proceed with feature
   * ```
   * 
   * Note: This is a convenience wrapper around hasAccess. The actual upgrade modal
   * display is typically handled by:
   * 1. This hook returning false (for proactive checks)
   * 2. Axios interceptor catching 402 responses (for API-level enforcement)
   * 
   * @param requiredTier The minimum tier required for the feature
   * @returns true if access granted, false if upgrade needed
   */
  const requiresTier = useCallback(
    (requiredTier: SubscriptionTier): boolean => {
      const access = hasAccess(requiredTier);
      if (!access) {
        // In a full implementation, this would dispatch an action to show UpgradeModal
        // For now, components should handle the false return value
        console.warn(
          `Feature requires ${requiredTier} tier. Current tier: ${tier || 'free'}`
        );
      }
      return access;
    },
    [hasAccess, tier]
  );
  
  /**
   * Check if a specific feature is available in the current tier.
   * 
   * @param feature Feature name with its required tier
   * @returns true if feature is available, false otherwise
   */
  const canUseFeature = useCallback(
    (feature: {
      name: string;
      requiredTier: SubscriptionTier;
    }): boolean => {
      return hasAccess(feature.requiredTier);
    },
    [hasAccess]
  );
  
  return {
    /**
     * Current user's subscription tier.
     * 'free' | 'pro' | 'pro_plus' | null if not authenticated
     */
    userTier: tier,
    
    /**
     * Check if user has access to a tier-gated feature.
     * Returns true if user tier >= required tier.
     */
    hasAccess,
    
    /**
     * Guard function that returns false and logs warning if tier insufficient.
     * Intended for use at the start of event handlers.
     */
    requiresTier,
    
    /**
     * Check feature availability by name and required tier.
     */
    canUseFeature,
    
    /**
     * Convenience booleans for common checks.
     */
    isPro: tier === 'pro' || tier === 'pro_plus',
    isProPlus: tier === 'pro_plus',
    isFree: tier === 'free' || tier === null,
  };
}
