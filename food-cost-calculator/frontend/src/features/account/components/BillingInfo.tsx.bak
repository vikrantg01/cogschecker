import type { FC } from 'react';

interface BillingInfoProps {
  currentPeriodEnd?: string;
  pendingDowngradeTier?: string;
}

/**
 * BillingInfo - displays billing renewal date.
 * Requirements: 11.7
 *
 * Shows when the current billing period ends. For Free tier accounts
 * with no billing period, displays informational text instead.
 */
export const BillingInfo: FC<BillingInfoProps> = ({
  currentPeriodEnd,
  pendingDowngradeTier,
}) => {
  if (!currentPeriodEnd) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 mb-1">Billing Information</h3>
        <p className="text-sm text-gray-600">
          You are currently on the Free tier with no billing.
        </p>
      </div>
    );
  }

  const renewalDate = new Date(currentPeriodEnd);
  const formattedDate = renewalDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <h3 className="text-sm font-medium text-gray-700 mb-1">Billing Information</h3>
      <div className="text-sm text-gray-600">
        {pendingDowngradeTier ? (
          <p>
            Current billing period ends on <span className="font-semibold">{formattedDate}</span>.
            Your subscription will be downgraded at the end of this period.
          </p>
        ) : (
          <p>
            Next billing date: <span className="font-semibold">{formattedDate}</span>
          </p>
        )}
      </div>
    </div>
  );
};
