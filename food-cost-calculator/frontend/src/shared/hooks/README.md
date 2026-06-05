# Shared Hooks

This directory contains reusable React hooks for the Food Cost Calculator frontend.

## Available Hooks

### `useSubscriptionGate`

Hook for handling subscription tier gating (402 Payment Required responses).

When an API call returns a 402 status code, this hook extracts the upgrade prompt information and manages the state needed to show an upgrade modal to the user.

**Usage Example:**

```tsx
import { useSubscriptionGate } from '@/shared/hooks';
import { UpgradeModal } from '@/shared/components/UpgradeModal';

function SquareIntegrationPage() {
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();

  const connectSquare = async () => {
    try {
      await apiClient.post(`/venues/${venueId}/square/connect`);
      // Success - Square connected
    } catch (error) {
      if (!handleApiError(error)) {
        // Handle other errors (not 402)
        console.error('Failed to connect Square:', error);
      }
    }
  };

  return (
    <>
      <button onClick={connectSquare}>Connect Square POS</button>
      
      {showUpgradeModal && requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage}
          onUpgrade={() => navigate('/account/subscription')}
        />
      )}
    </>
  );
}
```

**API:**

- `showUpgradeModal: boolean` - Whether the upgrade modal should be shown
- `requiredTier: SubscriptionTier | null` - The required tier for the feature
- `upgradeMessage: string | null` - The message to display in the modal
- `closeModal: () => void` - Call to close the upgrade modal
- `handleApiError: (error: unknown) => boolean` - Call with an API error to check if it's a 402 and automatically show the modal. Returns `true` if it was a 402 error.

### `useCostPropagation`

Hook that establishes a Server-Sent Events (SSE) connection to listen for real-time cost update notifications.

When ingredient prices change, the backend recalculates dependent recipe costs and publishes `COST_UPDATED` events. This hook receives those events and automatically invalidates the React Query cache for affected recipes, triggering a refetch of the updated data.

**Usage Example:**

```tsx
import { useCostPropagation } from '@/shared/hooks';
import { useQuery } from '@tanstack/react-query';

function RecipesPage() {
  const { currentVenueId } = useVenueStore();
  
  // Automatically sets up SSE listener for cost updates
  useCostPropagation();
  
  const { data: recipes } = useQuery({
    queryKey: ['recipes', currentVenueId],
    queryFn: () => fetchRecipes(currentVenueId),
  });

  // When ingredient prices change, recipes will auto-refresh
  return <RecipeList recipes={recipes} />;
}
```

**How it works:**

1. User updates an ingredient price via the API
2. `CostPropagationWorker` recalculates dependent recipe costs (backend)
3. Worker publishes `COST_UPDATED` event to Redis pub/sub
4. SSE service forwards event to connected clients
5. This hook receives the event and invalidates affected queries
6. React Query automatically refetches the updated recipe data

**Connection Management:**

- Opens SSE connection when a venue is selected and user is authenticated
- Closes connection when venue changes or component unmounts
- Automatically reconnects on connection failure (handled by browser)

**Invalidated Queries:**

When a `COST_UPDATED` event is received, the following queries are invalidated:

- `['recipe', recipeId]` - Individual recipe queries
- `['recipeDetail', recipeId]` - Detailed recipe queries
- `['recipes', venueId]` - Recipe list query
- `['costingReport', venueId]` - Costing report query

**Note on Authentication:**

The current implementation passes the auth token as a query parameter because the standard `EventSource` API doesn't support custom headers. In production, consider implementing one of the following alternatives:

1. Use cookie-based authentication for SSE endpoints
2. Use a library like `eventsource` (npm) that supports custom headers
3. Implement a short-lived SSE token endpoint

## Requirements Mapping

- **useSubscriptionGate**: Implements Requirement 11.3 (Subscription tier gating)
- **useCostPropagation**: Implements Requirement 3.3 (Real-time cost propagation)
