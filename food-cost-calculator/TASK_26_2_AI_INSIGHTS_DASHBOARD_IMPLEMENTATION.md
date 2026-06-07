# Task 26.2: AI Insights Dashboard Implementation

## Overview
Implemented the AI Insights dashboard frontend page that displays AI-generated insights for recipe profitability and supplier cost management. This is a Pro+ tier exclusive feature.

## Implementation Details

### 1. Type Definitions
**File**: `frontend/src/types/api.ts`

Added two new interfaces:
- `AIInsight`: Represents an AI-generated insight with title, explanation, supporting data, recommended action, and status
- `InsightDataAvailability`: Tracks whether sufficient sales data exists to generate insights

```typescript
export interface AIInsight {
  id: string;
  venueId: string;
  insightType: 'recipe_profitability' | 'supplier_cost';
  title: string;
  explanation: string;
  supportingData: Record<string, any>;
  recommendedAction: string;
  status: 'active' | 'actioned' | 'dismissed';
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsightDataAvailability {
  hasSufficientData: boolean;
  daysOfData?: number;
  minimumDaysRequired: number;
  estimatedAvailableDate?: string;
  message?: string;
}
```

### 2. InsightsPage Component
**File**: `frontend/src/features/insights/InsightsPage.tsx`

Implemented a comprehensive insights dashboard with the following features:

#### Key Features:

1. **Subscription Gate Integration**
   - Uses `useSubscriptionGate` hook to handle 402 Payment Required responses
   - Shows upgrade modal when Pro+ subscription is required
   - Gracefully handles API errors related to subscription tier

2. **Insufficient Data Message**
   - Fetches data availability status from `/venues/:venueId/insights/availability`
   - Displays informative card when less than 30 days of sales data available
   - Shows estimated date when insights will become available
   - Lists requirements: 30 days of Square POS data, 10+ transactions, Pro+ subscription

3. **Insight Cards**
   - Displays active insights in a clean, modern card layout
   - Each card includes:
     - **Visual indicator**: Icon and colored border based on insight type
     - **Type badge**: "Recipe Profitability" or "Supplier Cost"
     - **Title**: Clear headline of the insight
     - **Explanation**: Plain-language description of the finding
     - **Supporting Data**: Key metrics displayed in a grid (percentages, costs, etc.)
     - **Recommended Action**: Highlighted suggestion with icon
     - **Action buttons**: "Dismiss" and "Mark as Actioned"

4. **Insight Types**
   - **Recipe Profitability**: Purple theme with bar chart icon
   - **Supplier Cost**: Amber theme with dollar sign icon

5. **Status Management**
   - Users can mark insights as "actioned" or "dismissed"
   - API call to `PATCH /venues/:venueId/insights/:id/status`
   - Dismissed insights won't reappear unless new data produces different recommendations
   - Optimistic UI updates with React Query cache invalidation

6. **Empty States**
   - Loading state with spinner
   - No active insights (all actioned/dismissed)
   - Error state with retry option

7. **UI/UX Details**
   - Responsive design following existing patterns
   - Modern SaaS aesthetic with gradients and shadows
   - Smooth animations and transitions
   - Last updated timestamp display
   - Formatted dates for better readability
   - Supporting data dynamically formatted (percentages, currency)

### 3. API Integration

The component integrates with the following backend endpoints:

1. `GET /venues/:venueId/insights` - Fetch active insights
2. `GET /venues/:venueId/insights/availability` - Check data availability
3. `PATCH /venues/:venueId/insights/:id/status` - Update insight status

Uses React Query for:
- Automatic caching
- Background refetching
- Optimistic updates
- Error handling

### 4. Design Patterns

Follows existing codebase patterns:
- Uses `useVenueStore` for current venue context
- Uses `apiClient` with automatic token injection and venue ID headers
- Uses shared components (`UpgradeModal`)
- Uses shared hooks (`useSubscriptionGate`)
- Follows existing CSS variable system and utility classes
- Matches styling of other feature pages (IngredientsPage, RecipesPage)

### 5. Accessibility

- Semantic HTML structure
- ARIA labels for icon buttons
- Keyboard navigation support
- Focus visible states
- Screen reader friendly content

## Requirements Satisfied

**Requirement 13.1**: ✅ Displays insights in dedicated dashboard when Pro+ tier and 30+ days of data available

**Requirement 13.2**: ✅ Shows recipe profitability insights with specific recommendations

**Requirement 13.3**: ✅ Shows supplier cost insights for price increases

**Requirement 13.4**: ✅ Displays last updated timestamp

**Requirement 13.5**: ✅ Allows marking insights as "actioned" or "dismissed"

**Requirement 13.6**: ✅ Shows insufficient data message with minimum requirements and estimated date

**Requirement 13.7**: ✅ Displays plain-language explanation, supporting data, and recommended action

**Requirement 13.8**: ✅ No autonomous changes - all actions require explicit user confirmation

## Files Modified

1. `frontend/src/types/api.ts` - Added AIInsight and InsightDataAvailability interfaces
2. `frontend/src/features/insights/InsightsPage.tsx` - Implemented full dashboard component

## Testing Notes

- Component compiles without TypeScript errors
- No runtime diagnostics issues
- Router already configured with `/insights` path
- Follows existing authentication and authorization patterns
- Subscription gate will trigger 402 response for non-Pro+ users

## Next Steps

To fully test the implementation:
1. Backend API endpoints need to be implemented (tasks 26.1 and earlier)
2. Test with Pro+ subscription and sufficient sales data
3. Test with Free/Pro subscriptions (should show upgrade modal)
4. Test with insufficient data (should show data gathering message)
5. Verify action buttons update insight status correctly

## Dependencies

- React Query for data fetching
- React Router for navigation
- Zustand for venue state management
- Axios for API calls
- Existing shared components and hooks
