/**
 * Usage Examples for Shared Hooks
 * 
 * These examples demonstrate how to use the useSubscriptionGate and useCostPropagation hooks.
 * These are NOT runnable components - just reference examples for developers.
 */

import { useSubscriptionGate, useCostPropagation } from './index';
import { useNavigate } from 'react-router-dom';
import { useVenueStore } from '../../store/venueSlice';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/**
 * Example 1: Using useSubscriptionGate to gate a feature
 * 
 * This example shows how to check if a feature requires an upgrade
 * and display an appropriate modal when the user tries to access it.
 */
export function SquareIntegrationExample() {
  const navigate = useNavigate();
  const { currentVenueId } = useVenueStore();
  
  // Set up the subscription gate hook
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();

  const connectSquare = async () => {
    try {
      // Attempt to connect Square (this endpoint requires Pro tier)
      await apiClient.post(`/venues/${currentVenueId}/square/connect`);
      
      // Success! Navigate to Square settings
      navigate('/square/settings');
    } catch (error) {
      // Check if this is a 402 error (subscription gate)
      if (!handleApiError(error)) {
        // Not a 402 - handle other errors
        console.error('Failed to connect Square:', error);
        alert('Failed to connect Square. Please try again.');
      }
      // If it was a 402, the upgrade modal will be shown automatically
    }
  };

  return (
    <div>
      <h2>Square POS Integration</h2>
      <p>Connect your Square POS to automatically sync menu prices.</p>
      
      <button onClick={connectSquare}>
        Connect Square
      </button>

      {/* The upgrade modal will be shown when a 402 error is encountered */}
      {showUpgradeModal && requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage || undefined}
          onUpgrade={() => {
            closeModal();
            navigate('/account/subscription');
          }}
        />
      )}
    </div>
  );
}

/**
 * Example 2: Using useCostPropagation for real-time updates
 * 
 * This example shows how to set up automatic cache invalidation
 * when recipe costs are updated in real-time.
 */
export function RecipesPageExample() {
  const { currentVenueId } = useVenueStore();
  
  // Set up the SSE listener for cost updates
  // This will automatically invalidate queries when costs change
  useCostPropagation();
  
  // Fetch recipes - they will auto-refresh when costs change
  const { data: recipes, isLoading } = useQuery({
    queryKey: ['recipes', currentVenueId],
    queryFn: async () => {
      const response = await apiClient.get(`/venues/${currentVenueId}/recipes`);
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  if (isLoading) return <div>Loading recipes...</div>;

  return (
    <div>
      <h2>Recipes</h2>
      <p>
        Recipe costs will automatically update when ingredient prices change.
      </p>
      
      {recipes?.map((recipe: any) => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
        />
      ))}
    </div>
  );
}

/**
 * Example 3: Using both hooks together
 * 
 * This example shows a feature page that:
 * 1. Gates access based on subscription (AI Insights requires Pro+)
 * 2. Shows real-time updates when costs change
 */
export function InsightsPageExample() {
  const navigate = useNavigate();
  const { currentVenueId } = useVenueStore();
  
  // Set up subscription gating
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();
  
  // Set up real-time cost updates
  useCostPropagation();
  
  // Fetch AI insights (Pro+ feature)
  const { data: insights, isLoading } = useQuery({
    queryKey: ['insights', currentVenueId],
    queryFn: async () => {
      try {
        const response = await apiClient.get(`/venues/${currentVenueId}/insights`);
        return response.data;
      } catch (err) {
        // Check if this is a subscription gate error
        if (handleApiError(err)) {
          // This was a 402 - upgrade modal will be shown
          return null;
        }
        throw err;
      }
    },
    enabled: !!currentVenueId,
  });

  if (isLoading) return <div>Loading insights...</div>;

  return (
    <div>
      <h2>AI Insights</h2>
      <p>
        Get AI-powered recommendations to improve recipe profitability.
      </p>
      
      {insights?.map((insight: any) => (
        <InsightCard
          key={insight.id}
          insight={insight}
        />
      ))}

      {/* Upgrade modal for Pro+ features */}
      {showUpgradeModal && requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage || undefined}
          onUpgrade={() => {
            closeModal();
            navigate('/account/subscription');
          }}
        />
      )}
    </div>
  );
}

/**
 * Example 4: Proactive subscription check
 * 
 * You can also check subscription tier proactively before attempting
 * an action, instead of waiting for a 402 error.
 */
export function InvoiceUploadExample() {
  const { currentVenueId } = useVenueStore();
  const { handleApiError } = useSubscriptionGate();

  // Check if user has Pro tier before showing upload button
  // This would typically be done by checking the user's tier from auth state
  // For this example, we'll just show the button and handle 402 errors

  const handleInvoiceUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('invoice', file);

    try {
      await apiClient.post(
        `/venues/${currentVenueId}/invoices`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      
      alert('Invoice uploaded successfully!');
    } catch (error) {
      if (!handleApiError(error)) {
        console.error('Failed to upload invoice:', error);
        alert('Failed to upload invoice. Please try again.');
      }
    }
  };

  return (
    <div>
      <h2>Upload Supplier Invoice</h2>
      <p>Upload a PDF or image of your supplier invoice for automatic ingredient price extraction.</p>
      
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleInvoiceUpload(file);
        }}
      />
    </div>
  );
}

// Mock components for the examples above
function UpgradeModal(_props: any) { return null; }
function RecipeCard(_props: any) { return null; }
function InsightCard(_props: any) { return null; }
