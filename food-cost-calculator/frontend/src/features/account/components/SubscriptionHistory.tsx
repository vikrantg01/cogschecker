import type { FC } from 'react';
import type { SubscriptionHistoryResponse, SubscriptionTier } from '../../../types/api';

interface SubscriptionHistoryProps {
  history: SubscriptionHistoryResponse[];
}

const TIER_NAMES: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  pro_plus: 'Pro+',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  TIER_UPGRADED: 'Tier Upgraded',
  TIER_DOWNGRADED: 'Tier Downgraded',
  PAYMENT_SUCCEEDED: 'Payment Succeeded',
  PAYMENT_FAILED: 'Payment Failed',
  SUBSCRIPTION_CANCELLED: 'Subscription Cancelled',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  TIER_UPGRADED: 'text-green-600',
  TIER_DOWNGRADED: 'text-orange-600',
  PAYMENT_SUCCEEDED: 'text-green-600',
  PAYMENT_FAILED: 'text-red-600',
  SUBSCRIPTION_CANCELLED: 'text-gray-600',
};

/**
 * SubscriptionHistory - displays past tier changes and payment events.
 * Requirements: 11.9
 *
 * Shows a chronological list of subscription events including tier changes
 * and payment status updates.
 */
export const SubscriptionHistory: FC<SubscriptionHistoryProps> = ({ history }) => {
  if (history.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Subscription History</h2>
        <p className="text-gray-600 text-sm">No subscription history available.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Subscription History</h2>
      <div className="space-y-4">
        {history.map((entry) => {
          const eventDate = new Date(entry.createdAt);
          const formattedDate = eventDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          const formattedTime = eventDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div
              key={entry.id}
              className="flex items-start border-l-2 border-gray-200 pl-4 py-2"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`font-medium ${
                      EVENT_TYPE_COLORS[entry.eventType] || 'text-gray-700'
                    }`}
                  >
                    {EVENT_TYPE_LABELS[entry.eventType] || entry.eventType}
                  </span>
                  {entry.fromTier && entry.toTier && (
                    <span className="text-sm text-gray-600">
                      {TIER_NAMES[entry.fromTier]} → {TIER_NAMES[entry.toTier]}
                    </span>
                  )}
                </div>
                {entry.description && (
                  <p className="text-sm text-gray-600 mb-1">{entry.description}</p>
                )}
                <p className="text-xs text-gray-500">
                  {formattedDate} at {formattedTime}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
