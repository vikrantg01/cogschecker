# Task 19.3 Implementation Summary: Frontend Hooks

## Overview

Successfully implemented two critical React hooks for the Food Cost Calculator frontend:

1. **`useSubscriptionGate`** - Handles subscription tier gating (HTTP 402 responses)
2. **`useCostPropagation`** - SSE listener for real-time cost update notifications

## Files Created

### Core Implementation Files

1. **`frontend/src/shared/hooks/useSubscriptionGate.ts`**
   - Manages subscription gate errors (HTTP 402 Payment Required)
   - Extracts upgrade prompt information from API responses
   - Provides state management for upgrade modal display
   - **Requirements:** 11.3 - Subscription tier gating

2. **`frontend/src/shared/hooks/useCostPropagation.ts`**
   - Establishes SSE connection to backend cost event endpoint
   - Listens for `COST_UPDATED` events from Redis pub/sub
   - Automatically invalidates React Query cache for affected recipes
   - Implements manual SSE parsing with fetch() to support Authorization headers
   - Includes automatic reconnection logic with 5-second retry
   - **Requirements:** 3.3 - Real-time cost propagation

3. **`frontend/src/shared/hooks/index.ts`**
   - Barrel export file for clean imports
   - Exports both hooks for easy consumption

### Documentation Files

4. **`frontend/src/shared/hooks/README.md`**
   - Comprehensive documentation for both hooks
   - Usage examples and API reference
   - Notes on authentication and connection management
   - Requirements mapping

5. **`frontend/src/shared/hooks/USAGE_EXAMPLES.tsx`**
   - Four complete usage examples demonstrating:
     - Basic subscription gating with Square integration
     - Real-time cost updates on recipes page
     - Combined usage for AI insights page
     - Invoice upload with subscription checking

6. **`TASK_19_3_HOOKS_IMPLEMENTATION_SUMMARY.md`** (this file)
   - Complete implementation summary

## Implementation Details

### `useSubscriptionGate` Hook

**Purpose:** Handle subscription tier enforcement when API returns HTTP 402.

**Features:**
- Detects 402 Payment Required responses
- Extracts `UpgradePrompt` data from response body
- Manages modal state (show/hide)
- Returns `handleApiError` function for error checking

**Usage Pattern:**
```typescript
const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
  useSubscriptionGate();

try {
  await apiClient.post('/pro-feature');
} catch (error) {
  if (!handleApiError(error)) {
    // Handle non-402 errors
  }
}
```

**Integration Points:**
- Works with existing `UpgradeModal` component
- Integrates with Axios error responses
- Compatible with API's 402 response format

### `useCostPropagation` Hook

**Purpose:** Listen for real-time cost update events and invalidate React Query cache.

**Features:**
- Uses fetch() with manual SSE parsing (supports Authorization header)
- Automatic connection management (open/close based on venue/auth)
- Automatic reconnection with 5-second retry delay
- Validates events are for the current venue
- Comprehensive logging for debugging

**Event Flow:**
1. User updates ingredient price
2. Backend `CostPropagationWorker` recalculates dependent recipes
3. Worker publishes `COST_UPDATED` to Redis pub/sub channel `venue:{venueId}:costs`
4. SSE service forwards to connected clients
5. Hook invalidates React Query cache for affected recipes
6. React Query automatically refetches updated data

**Invalidated Queries:**
- `['recipe', recipeId]` - Individual recipe queries
- `['recipeDetail', recipeId]` - Detailed recipe queries
- `['recipes', venueId]` - Recipe list query
- `['costingReport', venueId]` - Costing report query

**Connection Management:**
- Opens on: venue selected + user authenticated
- Closes on: venue change, logout, or component unmount
- Reconnects on: connection failure (5s delay)

**Technical Note:**
The standard `EventSource` API doesn't support custom headers (like Authorization). This implementation uses fetch() with manual SSE parsing to support the `Authorization: Bearer <token>` header required by the backend.

## Type Safety Improvements

Fixed type import errors across multiple files to comply with TypeScript's `verbatimModuleSyntax`:

- `frontend/src/shared/components/CostBadge.tsx`
- `frontend/src/shared/components/ThresholdIndicator.tsx`
- `frontend/src/shared/components/UomSelect.tsx`
- `frontend/src/shared/components/UpgradeModal.tsx`
- `frontend/src/shared/hooks/useSubscriptionGate.ts`

All type-only imports now use the `import type` syntax.

## Build Verification

✅ TypeScript compilation successful  
✅ Vite build successful  
✅ All type errors resolved  
✅ No ESLint violations in new code

```bash
npm run build
# Output:
# ✓ 100 modules transformed.
# dist/index.html                   0.45 kB │ gzip:   0.29 kB
# dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:   0.81 kB
# dist/assets/index-9WQi4lUy.js   320.34 kB │ gzip: 100.07 kB
# ✓ built in 109ms
```

## Integration Guide

### For Recipe Pages

Add `useCostPropagation()` to any page that displays recipe costs:

```typescript
function RecipesPage() {
  useCostPropagation(); // Auto-invalidates on cost changes
  
  const { data: recipes } = useQuery(['recipes', venueId], fetchRecipes);
  return <RecipeList recipes={recipes} />;
}
```

### For Pro/Pro+ Features

Wrap Pro/Pro+ feature API calls with subscription gate error handling:

```typescript
function SquareSettings() {
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } =
    useSubscriptionGate();

  const connect = async () => {
    try {
      await apiClient.post('/square/connect');
    } catch (error) {
      if (!handleApiError(error)) {
        // Handle other errors
      }
    }
  };

  return (
    <>
      <button onClick={connect}>Connect</button>
      {showUpgradeModal && requiredTier && (
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={closeModal}
          requiredTier={requiredTier}
          message={upgradeMessage}
        />
      )}
    </>
  );
}
```

## Backend Dependencies

### SSE Endpoint
- **URL:** `GET /api/v1/venues/:venueId/cost-events`
- **Auth:** Bearer token via Authorization header
- **Response:** `text/event-stream`
- **Events:** `connected`, `COST_UPDATED`

### Event Format
```json
{
  "event": "COST_UPDATED",
  "venueId": "uuid",
  "recipeIds": ["uuid1", "uuid2"],
  "timestamp": 1234567890
}
```

### Backend Components
- `CostEventController` - SSE endpoint
- `CostEventSseService` - Redis pub/sub subscriber
- `CostPropagationWorker` - Event publisher

## Testing Recommendations

### Manual Testing

1. **Subscription Gate Testing:**
   - Attempt to access Pro feature on Free tier
   - Verify upgrade modal shows correct tier and message
   - Test with expired/failed payment (402 responses)

2. **Cost Propagation Testing:**
   - Open recipes page in browser
   - Update ingredient price in another tab/window
   - Verify recipe costs auto-update without refresh
   - Check browser console for SSE connection logs

3. **Reconnection Testing:**
   - Stop backend server while SSE connected
   - Verify reconnection after 5 seconds
   - Restart backend and verify events resume

### Automated Testing (Future)

Consider adding:
- Unit tests for `handleApiError` logic
- Unit tests for SSE message parsing
- Integration tests with mock SSE server
- E2E tests for full flow

## Requirements Validation

✅ **Requirement 3.3** - Real-time cost propagation  
- `useCostPropagation` establishes SSE connection
- Invalidates queries on `COST_UPDATED` events
- Frontend automatically refetches updated costs

✅ **Requirement 11.3** - Subscription tier gating  
- `useSubscriptionGate` handles 402 responses
- Extracts and displays upgrade prompts
- Provides clean API for error handling

## Notes for Developers

### Production Considerations

1. **SSE Authentication:**
   - Current implementation uses fetch() with Authorization header
   - Consider cookie-based auth for SSE in production for better security
   - Alternative: Short-lived SSE-specific tokens

2. **Connection Limits:**
   - Browser typically limits 6 SSE connections per domain
   - If multiple tabs open, connections may be shared or queued
   - Consider implementing connection sharing across tabs

3. **Reconnection Strategy:**
   - Current: 5-second fixed delay
   - Consider: Exponential backoff for repeated failures
   - Consider: Give up after N failures and require manual refresh

4. **Error Handling:**
   - SSE connection errors are logged but don't block UI
   - Users can still work without real-time updates
   - Manual refresh always works as fallback

### Known Limitations

1. **EventSource API:**
   - Standard API doesn't support custom headers
   - Manual implementation required for Authorization
   - fetch() + ReadableStream provides solution

2. **Reconnection:**
   - Simple 5-second retry (not exponential backoff)
   - No max retry limit (will retry indefinitely)
   - Consider adding exponential backoff if issues arise

3. **Cross-Tab State:**
   - Each tab maintains its own SSE connection
   - React Query cache is not shared across tabs
   - Users may see stale data in inactive tabs

## Success Criteria

✅ Both hooks implemented and building successfully  
✅ Type-safe with proper TypeScript types  
✅ Comprehensive documentation and examples provided  
✅ Integration with existing components (UpgradeModal)  
✅ Compatible with backend SSE implementation  
✅ No breaking changes to existing code  
✅ Clean export structure via index file

## Next Steps

1. **Integration:** Use hooks in relevant feature pages:
   - Add `useCostPropagation` to RecipesPage, RecipeDetailPage, CostingReportPage
   - Add `useSubscriptionGate` to SquareIntegrationPage, InvoiceUploadPage, InsightsPage

2. **Testing:** Implement manual and automated tests

3. **Monitoring:** Add analytics events for:
   - SSE connection failures
   - 402 responses (feature access attempts)
   - Upgrade modal conversions

4. **Optimization:** Consider:
   - Connection pooling across tabs
   - Exponential backoff for reconnection
   - Selective query invalidation based on visible recipes

## Conclusion

Task 19.3 is complete. Both hooks are implemented, documented, and ready for integration into the frontend application. The implementation follows React best practices, integrates cleanly with existing infrastructure (React Query, Zustand, Axios), and provides a solid foundation for subscription gating and real-time updates.
