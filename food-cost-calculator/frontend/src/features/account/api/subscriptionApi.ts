import { apiClient } from '../../../lib/api';
import type {
  SubscriptionResponse,
  SubscriptionHistoryResponse,
  UpgradeSubscriptionRequest,
  DowngradeSubscriptionRequest,
  DowngradeConflictResponse,
} from '../../../types/api';

/**
 * Get current subscription details for an organisation.
 * Requirements: 11.1, 11.7
 */
export const getSubscription = async (orgId: string): Promise<SubscriptionResponse> => {
  const response = await apiClient.get<SubscriptionResponse>(
    `/organisations/${orgId}/subscription`
  );
  return response.data;
};

/**
 * Upgrade subscription tier.
 * Requirements: 11.4
 *
 * Note: This endpoint expects that Stripe payment processing has already been
 * completed by the frontend before calling.
 */
export const upgradeSubscription = async (
  orgId: string,
  request: UpgradeSubscriptionRequest
): Promise<SubscriptionResponse> => {
  const response = await apiClient.post<SubscriptionResponse>(
    `/organisations/${orgId}/subscription/upgrade`,
    request
  );
  return response.data;
};

/**
 * Schedule subscription downgrade.
 * Requirements: 11.5, 11.6
 *
 * The downgrade is scheduled to take effect at the end of the current billing period.
 * May return 409 if conflicts exist (e.g., too many venues or recipes).
 */
export const scheduleDowngrade = async (
  orgId: string,
  request: DowngradeSubscriptionRequest
): Promise<SubscriptionResponse> => {
  const response = await apiClient.post<SubscriptionResponse>(
    `/organisations/${orgId}/subscription/downgrade`,
    request
  );
  return response.data;
};

/**
 * Cancel a pending downgrade.
 * Requirements: 11.5
 */
export const cancelPendingDowngrade = async (orgId: string): Promise<SubscriptionResponse> => {
  const response = await apiClient.delete<SubscriptionResponse>(
    `/organisations/${orgId}/subscription/downgrade`
  );
  return response.data;
};

/**
 * Check for downgrade conflicts.
 * Requirements: 11.6
 *
 * Returns conflict information including excess venues and recipes.
 */
export const checkDowngradeConflicts = async (
  orgId: string,
  targetTier: string
): Promise<DowngradeConflictResponse> => {
  const response = await apiClient.get<DowngradeConflictResponse>(
    `/organisations/${orgId}/subscription/downgrade-conflicts`,
    {
      params: { targetTier },
    }
  );
  return response.data;
};

/**
 * Get subscription history.
 * Requirements: 11.9
 *
 * Returns a list of past tier changes and payment events.
 */
export const getSubscriptionHistory = async (
  orgId: string
): Promise<SubscriptionHistoryResponse[]> => {
  const response = await apiClient.get<SubscriptionHistoryResponse[]>(
    `/organisations/${orgId}/subscription/history`
  );
  return response.data;
};
