import type { FC } from 'react';
import type { SubscriptionTier } from '../../types/api';

interface UpgradeModalProps {
  /**
   * Whether the modal is currently visible.
   */
  isOpen: boolean;
  /**
   * Callback to close the modal.
   */
  onClose: () => void;
  /**
   * The required subscription tier to access the feature.
   */
  requiredTier: SubscriptionTier;
  /**
   * Optional custom message explaining why upgrade is needed.
   */
  message?: string;
  /**
   * Callback when user clicks the upgrade button.
   */
  onUpgrade?: () => void;
}

/**
 * Tier display names for user-facing text.
 */
const TIER_NAMES: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_plus: 'Pro+',
};

/**
 * Feature lists for each tier to help users understand what they're upgrading to.
 */
const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  free: [
    'Up to 2 venues',
    'Up to 25 recipes per venue',
    'Manual data entry',
  ],
  pro: [
    'Unlimited venues',
    'Unlimited recipes',
    'Square POS integration',
    'Invoice upload & OCR',
  ],
  pro_plus: [
    'All Pro features',
    'AI-driven insights',
    'Recipe profitability analysis',
    'Supplier cost management',
  ],
};

/**
 * UpgradeModal - modal dialog triggered on 402 Payment Required response.
 * 
 * Displays when a user attempts to access a feature that requires a higher
 * subscription tier. Shows the required tier, its features, and provides
 * upgrade and dismiss actions.
 * 
 * @example
 * // Basic usage
 * <UpgradeModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   requiredTier="pro"
 *   onUpgrade={() => navigate('/account/subscription')}
 * />
 * 
 * // With custom message
 * <UpgradeModal
 *   isOpen={true}
 *   onClose={handleClose}
 *   requiredTier="pro_plus"
 *   message="AI insights require a Pro+ subscription"
 *   onUpgrade={handleUpgrade}
 * />
 */
export const UpgradeModal: FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  requiredTier,
  message,
  onUpgrade,
}) => {
  if (!isOpen) {
    return null;
  }

  const tierName = TIER_NAMES[requiredTier];
  const features = TIER_FEATURES[requiredTier];
  const defaultMessage = `This feature requires a ${tierName} subscription.`;

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    }
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
          <h2
            id="upgrade-modal-title"
            className="text-xl font-semibold text-white"
          >
            Upgrade Required
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-gray-700 mb-4">
            {message || defaultMessage}
          </p>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-5">
            <h3 className="text-sm font-semibold text-purple-900 mb-2">
              {tierName} Features
            </h3>
            <ul className="space-y-1">
              {features.map((feature, index) => (
                <li
                  key={index}
                  className="flex items-start text-sm text-gray-700"
                >
                  <span className="text-purple-500 mr-2">✓</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Maybe Later
          </button>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Upgrade to {tierName}
          </button>
        </div>
      </div>
    </div>
  );
};
