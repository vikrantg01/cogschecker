import type { FC } from 'react';

interface PaymentFailedBannerProps {
  paymentFailedAt: string;
  onUpdatePayment: () => void;
}

/**
 * PaymentFailedBanner - displays when a subscription payment has failed.
 * Requirements: 11.8
 *
 * Shows a prominent warning banner when payment has failed, with a call-to-action
 * to update payment information. The organization will be downgraded to Free tier
 * if payment remains unsuccessful after 7 days.
 */
export const PaymentFailedBanner: FC<PaymentFailedBannerProps> = ({
  paymentFailedAt,
  onUpdatePayment,
}) => {
  const failedDate = new Date(paymentFailedAt);
  const daysSinceFailure = Math.floor(
    (Date.now() - failedDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const daysRemaining = Math.max(0, 7 - daysSinceFailure);

  return (
    <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-500"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800">Payment Failed</h3>
          <div className="mt-2 text-sm text-red-700">
            <p>
              Your last payment was unsuccessful. Please update your payment information
              to continue using paid features.
            </p>
            {daysRemaining > 0 ? (
              <p className="mt-1 font-semibold">
                Your account will be downgraded to the Free tier in {daysRemaining}{' '}
                {daysRemaining === 1 ? 'day' : 'days'} if payment is not resolved.
              </p>
            ) : (
              <p className="mt-1 font-semibold">
                Your account has been downgraded to the Free tier due to payment failure.
              </p>
            )}
          </div>
          <div className="mt-4">
            <button
              onClick={onUpdatePayment}
              className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Update Payment Information
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
