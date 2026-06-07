import { type FC, useState } from 'react';
import type { SubscriptionTier } from '../../../types/api';

interface UpgradeDowngradePanelProps {
  currentTier: SubscriptionTier;
  pendingDowngradeTier?: SubscriptionTier;
  onUpgrade: (targetTier: SubscriptionTier) => void;
  onDowngrade: (targetTier: SubscriptionTier) => void;
  onCancelDowngrade: () => void;
}

const TIER_INFO: Record<
  SubscriptionTier,
  {
    name: string;
    price: string;
    features: string[];
  }
> = {
  free: {
    name: 'Free',
    price: '$0/month',
    features: [
      'Up to 2 venues',
      'Up to 25 recipes per venue',
      'Manual data entry',
      'Basic cost calculations',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$49/month',
    features: [
      'Unlimited venues',
      'Unlimited recipes',
      'Square POS integration',
      'Invoice upload & OCR',
      'Advanced reporting',
    ],
  },
  pro_plus: {
    name: 'Pro+',
    price: '$99/month',
    features: [
      'All Pro features',
      'AI-driven insights',
      'Recipe profitability analysis',
      'Supplier cost management',
      'Priority support',
    ],
  },
};

const TIER_ORDER: SubscriptionTier[] = ['free', 'pro', 'pro_plus'];

/**
 * UpgradeDowngradePanel - manages upgrade and downgrade flows.
 * Requirements: 11.4, 11.5
 *
 * Displays available tiers and provides upgrade/downgrade actions.
 * For upgrades, initiates Stripe payment flow.
 * For downgrades, schedules the change for the end of the billing period.
 */
export const UpgradeDowngradePanel: FC<UpgradeDowngradePanelProps> = ({
  currentTier,
  pendingDowngradeTier,
  onUpgrade,
  onDowngrade,
  onCancelDowngrade,
}) => {
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);

  const currentTierIndex = TIER_ORDER.indexOf(currentTier);

  const handleTierSelect = (tier: SubscriptionTier) => {
    setSelectedTier(tier);
  };

  const handleConfirm = () => {
    if (!selectedTier) return;

    const selectedIndex = TIER_ORDER.indexOf(selectedTier);
    
    if (selectedIndex > currentTierIndex) {
      // Upgrade
      onUpgrade(selectedTier);
    } else if (selectedIndex < currentTierIndex) {
      // Downgrade
      onDowngrade(selectedTier);
    }
    
    setSelectedTier(null);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Manage Subscription</h2>

      {pendingDowngradeTier && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-orange-800 mb-1">
                Downgrade Scheduled
              </h3>
              <p className="text-sm text-orange-700">
                Your subscription will downgrade to {TIER_INFO[pendingDowngradeTier].name} at
                the end of the current billing period.
              </p>
            </div>
            <button
              onClick={onCancelDowngrade}
              className="text-sm text-orange-700 underline hover:text-orange-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TIER_ORDER.map((tier) => {
          const info = TIER_INFO[tier];
          const isCurrent = tier === currentTier;
          const tierIndex = TIER_ORDER.indexOf(tier);
          const isUpgrade = tierIndex > currentTierIndex;
          const isSelected = tier === selectedTier;

          return (
            <div
              key={tier}
              className={`border-2 rounded-lg p-6 ${
                isCurrent
                  ? 'border-purple-500 bg-purple-50'
                  : isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200'
              }`}
            >
              <div className="text-center mb-4">
                <h3 className="text-xl font-bold mb-2">{info.name}</h3>
                <p className="text-2xl font-semibold text-purple-600">{info.price}</p>
              </div>

              <ul className="space-y-2 mb-6">
                {info.features.map((feature, index) => (
                  <li key={index} className="flex items-start text-sm">
                    <span className="text-purple-500 mr-2 mt-0.5">✓</span>
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="text-center">
                  <span className="inline-block px-4 py-2 bg-purple-500 text-white rounded-md font-medium">
                    Current Plan
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => handleTierSelect(tier)}
                  className={`w-full py-2 rounded-md font-medium transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : isUpgrade
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {isUpgrade ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selectedTier && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-blue-900 mb-1">
                {TIER_ORDER.indexOf(selectedTier) > currentTierIndex
                  ? 'Confirm Upgrade'
                  : 'Confirm Downgrade'}
              </h3>
              <p className="text-sm text-blue-700">
                {TIER_ORDER.indexOf(selectedTier) > currentTierIndex
                  ? `You will be charged ${TIER_INFO[selectedTier].price} and upgrade immediately.`
                  : `Your subscription will downgrade to ${TIER_INFO[selectedTier].name} at the end of the current billing period.`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTier(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
