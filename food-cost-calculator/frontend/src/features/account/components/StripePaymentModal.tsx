import type { FC } from 'react';
import type { SubscriptionTier } from '../../../types/api';

interface StripePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetTier: SubscriptionTier;
  onPaymentComplete: (stripeCustomerId: string, stripeSubscriptionId: string, currentPeriodEnd: string) => void;
}

const TIER_PRICES: Record<SubscriptionTier, string> = {
  free: '$0',
  pro: '$49',
  pro_plus: '$99',
};

/**
 * StripePaymentModal - handles payment processing for upgrades.
 * Requirements: 11.4
 *
 * NOTE: This is a simplified placeholder implementation.
 * In production, this would integrate with Stripe Elements for secure payment processing.
 *
 * The real implementation should:
 * 1. Load Stripe.js and Elements
 * 2. Render a CardElement for payment input
 * 3. Call stripe.createPaymentMethod() to tokenize the card
 * 4. Submit to Stripe to create a subscription
 * 5. Handle 3D Secure authentication if required
 * 6. Return the Stripe customer ID and subscription ID on success
 */
export const StripePaymentModal: FC<StripePaymentModalProps> = ({
  isOpen,
  onClose,
  targetTier,
  onPaymentComplete,
}) => {
  if (!isOpen) {
    return null;
  }

  // Simplified mock payment - in production, this would handle real Stripe payment
  const handleMockPayment = () => {
    // Mock Stripe IDs - in production, these would come from Stripe API
    const mockCustomerId = `cus_mock_${Date.now()}`;
    const mockSubscriptionId = `sub_mock_${Date.now()}`;
    const mockPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    onPaymentComplete(mockCustomerId, mockSubscriptionId, mockPeriodEnd);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
      aria-labelledby="payment-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
          <h2 id="payment-modal-title" className="text-xl font-semibold text-white">
            Complete Payment
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="mb-4">
            <p className="text-gray-700 mb-2">
              You are upgrading to the <span className="font-semibold">{targetTier === 'pro' ? 'Pro' : 'Pro+'}</span> tier
            </p>
            <p className="text-2xl font-bold text-purple-600">
              {TIER_PRICES[targetTier]}/month
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-yellow-800">
              <strong>Note:</strong> This is a development placeholder. In production, Stripe
              payment elements would be rendered here for secure payment processing.
            </p>
          </div>

          {/* Placeholder for Stripe Elements - in production this would be the real Stripe CardElement */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4">
            <p className="text-sm text-gray-500 mb-2">Stripe Payment Element</p>
            <p className="text-xs text-gray-400">
              Card input would appear here in production
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Cancel
          </button>
          <button
            onClick={handleMockPayment}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Complete Payment (Mock)
          </button>
        </div>
      </div>
    </div>
  );
};
