# Task 25.1: Account Settings Page Implementation

## Overview

Implemented a comprehensive account settings page with subscription management features including current tier display, billing information, upgrade/downgrade flows with Stripe payment integration, subscription history, and payment failure notifications.

**Requirements Addressed:** 11.1, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9

## Implementation Summary

### 1. API Types and Interfaces

**File:** `frontend/src/types/api.ts`

Added TypeScript interfaces for subscription management:
- `SubscriptionResponse` - Full subscription details including tier, billing dates, Stripe IDs
- `SubscriptionHistoryResponse` - Individual history entries with event types and tier changes
- `SubscriptionEventType` - Enum for event types (TIER_UPGRADED, PAYMENT_FAILED, etc.)
- `UpgradeSubscriptionRequest` - Request payload for upgrades
- `DowngradeSubscriptionRequest` - Request payload for downgrades
- `DowngradeConflictResponse` - Conflict information when downgrade limits are exceeded

### 2. API Service Layer

**File:** `frontend/src/features/account/api/subscriptionApi.ts`

Created API functions that interface with the backend subscription controller:

```typescript
- getSubscription(orgId) - Fetch current subscription details
- upgradeSubscription(orgId, request) - Process tier upgrade
- scheduleDowngrade(orgId, request) - Schedule downgrade at billing period end
- cancelPendingDowngrade(orgId) - Cancel a pending downgrade
- checkDowngradeConflicts(orgId, targetTier) - Pre-check for downgrade conflicts
- getSubscriptionHistory(orgId) - Fetch subscription event history
```

All functions use the configured axios client with automatic authentication header injection.

### 3. UI Components

#### CurrentTierBadge
**File:** `frontend/src/features/account/components/CurrentTierBadge.tsx`
**Requirements:** 11.7

- Displays current subscription tier as a styled badge
- Shows color-coded badge (gray for Free, blue for Pro, purple for Pro+)
- Displays pending downgrade warning when applicable

#### BillingInfo
**File:** `frontend/src/features/account/components/BillingInfo.tsx`
**Requirements:** 11.7

- Shows billing renewal date for paid tiers
- Displays "no billing" message for Free tier
- Indicates when downgrade will take effect

#### PaymentFailedBanner
**File:** `frontend/src/features/account/components/PaymentFailedBanner.tsx`
**Requirements:** 11.8

- Prominent red banner displayed when payment fails
- Calculates and displays days remaining before automatic downgrade (7 days)
- Provides "Update Payment Information" call-to-action button
- Different messaging based on whether account has been downgraded

#### UpgradeDowngradePanel
**File:** `frontend/src/features/account/components/UpgradeDowngradePanel.tsx`
**Requirements:** 11.4, 11.5

- Displays all three tiers (Free, Pro, Pro+) with features and pricing
- Highlights current tier
- Provides upgrade/downgrade buttons for other tiers
- Shows pending downgrade notification with cancel option
- Displays confirmation UI before processing changes
- Indicates whether action is upgrade or downgrade

Features for each tier:
- **Free**: 2 venues, 25 recipes/venue, manual data entry
- **Pro**: Unlimited venues/recipes, Square POS, invoice OCR
- **Pro+**: All Pro features + AI insights and profitability analysis

#### SubscriptionHistory
**File:** `frontend/src/features/account/components/SubscriptionHistory.tsx`
**Requirements:** 11.9

- Chronological list of subscription events
- Color-coded event types (green for success, red for failures, etc.)
- Shows tier transitions with arrow notation (Free → Pro)
- Displays event descriptions and timestamps
- Empty state when no history exists

#### StripePaymentModal
**File:** `frontend/src/features/account/components/StripePaymentModal.tsx`
**Requirements:** 11.4

**Note:** This is a placeholder implementation for development.

Current implementation:
- Modal dialog for payment processing
- Displays target tier and pricing
- Mock payment completion (generates mock Stripe IDs)
- Returns necessary data to complete upgrade

Production implementation should:
1. Load Stripe.js and Elements library
2. Render CardElement for secure card input
3. Call stripe.createPaymentMethod() to tokenize
4. Submit to Stripe API to create subscription
5. Handle 3D Secure authentication if required
6. Return real Stripe customer and subscription IDs

#### DowngradeConflictModal
**File:** `frontend/src/features/account/components/DowngradeConflictModal.tsx`
**Requirements:** 11.6

- Displays when downgrade would violate tier limits
- Lists excess venues (e.g., "3 venues but Free tier allows 2")
- Lists venues with excess recipes (e.g., "Venue A has 30 recipes, limit is 25")
- Provides clear instructions on how to resolve conflicts
- Prevents downgrade until conflicts are resolved

### 4. Main Account Page

**File:** `frontend/src/features/account/AccountPage.tsx`

Complete account settings page with:

**State Management:**
- React Query for server state (subscription data, history)
- Local state for modals and selected tiers
- Zustand for getting organisation ID from current venue

**Features:**
1. **Current Subscription Display**
   - Tier badge with pending downgrade indicator
   - Billing renewal date
   - Payment failed banner (if applicable)

2. **Upgrade Flow**
   - Select target tier (Pro or Pro+)
   - Opens Stripe payment modal
   - On payment success, calls upgrade API
   - Invalidates cache and refreshes data

3. **Downgrade Flow**
   - Pre-checks for conflicts before scheduling
   - If conflicts exist, shows conflict modal
   - If no conflicts, schedules downgrade for billing period end
   - Handles 409 errors from backend with conflict details

4. **Cancel Downgrade**
   - Available when pending downgrade exists
   - Removes scheduled downgrade
   - Returns to current tier

5. **Subscription History**
   - Displays all past events
   - Automatically refreshes after tier changes

**Error Handling:**
- 409 Conflict responses trigger conflict modal
- Network errors are caught and logged
- Loading states prevent multiple submissions

## File Structure

```
frontend/src/features/account/
├── AccountPage.tsx                    # Main page component
├── api/
│   └── subscriptionApi.ts            # API service functions
└── components/
    ├── index.ts                       # Component exports
    ├── CurrentTierBadge.tsx          # Tier display badge
    ├── BillingInfo.tsx               # Billing date display
    ├── PaymentFailedBanner.tsx       # Payment failure notification
    ├── UpgradeDowngradePanel.tsx     # Tier selection and actions
    ├── SubscriptionHistory.tsx       # Event history list
    ├── StripePaymentModal.tsx        # Payment processing (placeholder)
    └── DowngradeConflictModal.tsx    # Conflict resolution dialog
```

## Integration Points

### Backend API Endpoints Used

All endpoints from `SubscriptionController`:

```
GET    /api/v1/organisations/:orgId/subscription
POST   /api/v1/organisations/:orgId/subscription/upgrade
POST   /api/v1/organisations/:orgId/subscription/downgrade
DELETE /api/v1/organisations/:orgId/subscription/downgrade
GET    /api/v1/organisations/:orgId/subscription/downgrade-conflicts
GET    /api/v1/organisations/:orgId/subscription/history
```

### Authentication & Authorization

- Uses organisation ID from current venue's `organisationId` field
- Requires Admin role (enforced by backend `@PreAuthorize`)
- Axios client automatically includes JWT token in Authorization header

### State Management

- **React Query** for server state with automatic caching and invalidation
- **Zustand** venue store to get current venue and organisation ID
- Local component state for UI interactions (modals, selections)

## Key Design Decisions

1. **Organisation ID from Venue**: Since the auth store doesn't include org ID, we derive it from the currently selected venue's `organisationId` field.

2. **Proactive Conflict Checking**: Before scheduling a downgrade, we call the conflict check endpoint to show conflicts immediately, providing better UX than waiting for a 409 error.

3. **Mock Stripe Integration**: A placeholder is used for Stripe payment processing to enable development and testing. The architecture supports drop-in replacement with real Stripe Elements.

4. **Tier Presentation**: All three tiers are always shown with current tier highlighted, making upgrade/downgrade options clear and promoting feature discovery.

5. **Billing Period Downgrades**: Follows the design requirement that downgrades take effect at billing period end, not immediately, allowing continued access to paid features.

## Testing Recommendations

### Manual Testing Checklist

1. **View Subscription**
   - [ ] Current tier displays correctly
   - [ ] Billing date shows for paid tiers
   - [ ] Free tier shows "no billing" message
   - [ ] Pending downgrade indicator appears when set

2. **Upgrade Flow**
   - [ ] Can select Pro tier from Free
   - [ ] Can select Pro+ tier from Free or Pro
   - [ ] Payment modal opens with correct tier and price
   - [ ] Mock payment completes successfully
   - [ ] Tier updates in UI after upgrade
   - [ ] History shows upgrade event

3. **Downgrade Flow**
   - [ ] Can select Free tier from Pro
   - [ ] Can select Pro tier from Pro+
   - [ ] Downgrade schedules for billing period end
   - [ ] Pending downgrade notification shows
   - [ ] Can cancel pending downgrade
   - [ ] History shows downgrade scheduled event

4. **Conflict Handling**
   - [ ] Conflict modal shows when exceeding limits
   - [ ] Lists excess venues correctly
   - [ ] Lists venues with excess recipes
   - [ ] Prevents downgrade until resolved

5. **Payment Failure**
   - [ ] Banner shows when paymentFailedAt is set
   - [ ] Calculates days remaining correctly
   - [ ] Shows different message after 7 days
   - [ ] Update payment button is functional

6. **Subscription History**
   - [ ] Shows all events chronologically
   - [ ] Event types color-coded correctly
   - [ ] Tier transitions display properly
   - [ ] Timestamps formatted correctly
   - [ ] Empty state shows when no history

### Integration Testing

When backend is running:

```bash
# Start frontend dev server
cd frontend
npm run dev

# Navigate to http://localhost:5173/account
# Ensure:
# 1. User is logged in
# 2. Venue is selected
# 3. User has Admin role
```

### Future Testing Enhancements

1. **Unit Tests**: Add Jest + React Testing Library tests for individual components
2. **Integration Tests**: Test React Query cache invalidation flows
3. **E2E Tests**: Cypress/Playwright tests for complete upgrade/downgrade flows
4. **Accessibility Tests**: Validate ARIA attributes and keyboard navigation

## Known Limitations & Future Work

### Stripe Integration

Current implementation is a mock. Production requires:
- Load Stripe.js library
- Implement Stripe Elements CardElement
- Handle payment method creation
- Process 3D Secure authentication
- Error handling for payment failures
- Customer Portal integration for payment updates

### Venue Name Display

The conflict modal shows venue IDs. Enhancement:
- Fetch venue names from API
- Display human-readable venue names in conflict lists

### Optimistic Updates

Current implementation waits for API responses. Could add:
- Optimistic UI updates for better perceived performance
- Revert on error with toast notifications

### Toast Notifications

Add success/error toasts for:
- Successful upgrades/downgrades
- Payment failures
- Conflict resolution guidance

### Accessibility

Current implementation has basic accessibility. Enhancements:
- Add comprehensive ARIA labels
- Improve keyboard navigation
- Test with screen readers
- Add focus management for modals

## Deployment Notes

### Environment Variables

No new environment variables required. Uses existing:
- `VITE_API_BASE_URL` - Backend API URL

### Build Verification

```bash
npm run build
# ✓ Build successful with no TypeScript errors
```

### Production Considerations

1. **Stripe Configuration**
   - Add Stripe publishable key to environment
   - Implement real Stripe Elements
   - Test payment flows in Stripe test mode

2. **Error Monitoring**
   - Add Sentry or similar for production error tracking
   - Monitor subscription mutation failures

3. **Analytics**
   - Track upgrade/downgrade events
   - Monitor payment success rates
   - A/B test tier presentation

## Requirements Validation

### ✅ Requirement 11.1
Display current subscription tier and billing details on account settings page.
- **Implemented**: CurrentTierBadge and BillingInfo components

### ✅ Requirement 11.4
Allow Admin to upgrade subscription by completing payment flow.
- **Implemented**: UpgradeDowngradePanel with StripePaymentModal (mock)

### ✅ Requirement 11.5
Allow Admin to schedule downgrade at billing period end.
- **Implemented**: Downgrade scheduling in UpgradeDowngradePanel

### ✅ Requirement 11.6
Check for conflicts before downgrade and display warnings.
- **Implemented**: DowngradeConflictModal with pre-check validation

### ✅ Requirement 11.7
Display organisation's current tier and billing renewal date.
- **Implemented**: CurrentTierBadge and BillingInfo

### ✅ Requirement 11.8
Display in-app banner when payment fails, notify of 7-day grace period.
- **Implemented**: PaymentFailedBanner with countdown

### ✅ Requirement 11.9
Display subscription history showing tier changes and payment events.
- **Implemented**: SubscriptionHistory component

## Conclusion

Task 25.1 has been successfully implemented with all required features for subscription management. The account settings page provides a complete interface for admins to view their current subscription, upgrade or downgrade tiers, manage billing, and review subscription history.

The implementation follows React best practices with:
- Component composition for reusability
- React Query for efficient data fetching
- TypeScript for type safety
- Accessible UI patterns
- Clear separation of concerns

The Stripe payment integration is currently a placeholder to enable development and testing. Implementing real Stripe Elements is straightforward using the existing architecture.
