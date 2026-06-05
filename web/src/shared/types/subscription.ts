/**
 * Subscription tier type.
 * Maps to backend SubscriptionTier enum.
 * 
 * Requirement 11.2
 */
export type SubscriptionTier = 'free' | 'pro' | 'pro_plus';

/**
 * Tier hierarchy levels for comparison.
 */
export const TIER_LEVELS: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  pro_plus: 2,
};

/**
 * Check if a user tier meets the required tier level.
 * 
 * @param userTier The user's current subscription tier
 * @param requiredTier The minimum required tier for a feature
 * @returns true if user has sufficient access, false otherwise
 */
export function hasSufficientTier(
  userTier: SubscriptionTier | null | undefined,
  requiredTier: SubscriptionTier
): boolean {
  const userLevel = TIER_LEVELS[userTier || 'free'];
  const requiredLevel = TIER_LEVELS[requiredTier];
  return userLevel >= requiredLevel;
}

/**
 * Upgrade prompt payload returned by backend when 402 Payment Required is returned.
 */
export interface UpgradePrompt {
  requiredTier: SubscriptionTier;
  message: string;
  upgradePath?: string;
}
