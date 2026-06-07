import type { FC } from 'react';
import type { SubscriptionTier } from '../../../types/api';

interface CurrentTierBadgeProps {
  tier: SubscriptionTier;
  pendingDowngradeTier?: SubscriptionTier;
}

const TIER_NAMES: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_plus: 'Pro+',
};

const TIER_COLORS: Record<SubscriptionTier, string> = {
  free: 'bg-gray-100 text-gray-800 border-gray-300',
  pro: 'bg-blue-100 text-blue-800 border-blue-300',
  pro_plus: 'bg-purple-100 text-purple-800 border-purple-300',
};

/**
 * CurrentTierBadge - displays the current subscription tier as a badge.
 * Requirements: 11.7
 *
 * Shows the current tier with appropriate styling. If a downgrade is pending,
 * displays a warning badge alongside the current tier.
 */
export const CurrentTierBadge: FC<CurrentTierBadgeProps> = ({
  tier,
  pendingDowngradeTier,
}) => {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`px-4 py-2 rounded-lg font-semibold border-2 ${TIER_COLORS[tier]}`}
      >
        {TIER_NAMES[tier]}
      </span>
      {pendingDowngradeTier && (
        <span className="text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded-md border border-orange-200">
          Downgrading to {TIER_NAMES[pendingDowngradeTier]} at period end
        </span>
      )}
    </div>
  );
};
