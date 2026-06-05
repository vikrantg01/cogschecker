# Shared UI Components

This directory contains reusable UI components used across the Food Cost Calculator application.

## Components

### CostBadge

Displays a cost value with support for missing-price placeholders.

**Props:**
- `value: number | null | undefined` - The cost to display
- `currency?: string` - Currency symbol (default: '$')
- `decimals?: number` - Decimal places (default: 2)
- `className?: string` - Additional CSS classes

**Usage:**
```tsx
import { CostBadge } from '@/shared/components';

// Display a cost
<CostBadge value={12.50} />

// Display missing price
<CostBadge value={null} /> // Shows "—"

// Custom decimals
<CostBadge value={45.678} decimals={3} />
```

---

### ThresholdIndicator

Color-coded badge showing whether food cost percentage exceeds or passes the target threshold.

**Props:**
- `foodCostPercentage: number | null | undefined` - The percentage to evaluate
- `threshold: number` - The target threshold
- `showValue?: boolean` - Show percentage value (default: false)
- `className?: string` - Additional CSS classes

**Colors:**
- Red: Exceeding threshold
- Green: Passing threshold
- Gray: N/A (no menu price set)

**Usage:**
```tsx
import { ThresholdIndicator } from '@/shared/components';

// Basic usage
<ThresholdIndicator foodCostPercentage={35.5} threshold={30} />
// Shows red "Exceeding" badge

// Show percentage value
<ThresholdIndicator foodCostPercentage={25.0} threshold={30} showValue />
// Shows green "25.0%" badge

// No menu price set
<ThresholdIndicator foodCostPercentage={null} threshold={30} />
// Shows gray "N/A" badge
```

---

### UomSelect

Grouped dropdown for selecting units of measure, organized by measurement dimension.

**Props:**
- `value: UnitOfMeasure` - Currently selected unit
- `onChange: (value: UnitOfMeasure) => void` - Change handler
- `id?: string` - Input ID
- `name?: string` - Input name
- `disabled?: boolean` - Disabled state
- `required?: boolean` - Required validation
- `className?: string` - Additional CSS classes

**Groups:**
- **Weight:** g, kg, oz, lb
- **Volume:** ml, L, tsp, tbsp, cup
- **Count:** each

**Usage:**
```tsx
import { UomSelect } from '@/shared/components';
import { useState } from 'react';

const [uom, setUom] = useState<UnitOfMeasure>('g');

<UomSelect 
  value={uom} 
  onChange={setUom}
  required
/>
```

---

### UpgradeModal

Modal dialog triggered on 402 Payment Required responses. Shows required tier, features, and upgrade options.

**Props:**
- `isOpen: boolean` - Modal visibility state
- `onClose: () => void` - Close handler
- `requiredTier: SubscriptionTier` - Required subscription tier
- `message?: string` - Custom message
- `onUpgrade?: () => void` - Upgrade button handler

**Usage:**
```tsx
import { UpgradeModal } from '@/shared/components';
import { useSubscriptionGate } from '@/shared/hooks';
import { useNavigate } from 'react-router-dom';

const MyComponent = () => {
  const navigate = useNavigate();
  const { showUpgradeModal, requiredTier, upgradeMessage, closeModal, handleApiError } = 
    useSubscriptionGate();

  const handleAction = async () => {
    try {
      await api.post('/some-pro-feature', data);
    } catch (error) {
      if (!handleApiError(error)) {
        // Handle other errors
        console.error(error);
      }
    }
  };

  return (
    <>
      <button onClick={handleAction}>Pro Feature</button>
      
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={closeModal}
        requiredTier={requiredTier!}
        message={upgradeMessage}
        onUpgrade={() => navigate('/account/subscription')}
      />
    </>
  );
};
```

---

## Custom Hook: useSubscriptionGate

Handles 402 Payment Required responses and manages UpgradeModal state.

**Returns:**
- `showUpgradeModal: boolean` - Modal visibility
- `requiredTier: SubscriptionTier | null` - Required tier
- `upgradeMessage: string | null` - Upgrade message
- `closeModal: () => void` - Close modal
- `handleApiError: (error: unknown) => boolean` - Check if error is 402

**Usage:**
```tsx
import { useSubscriptionGate } from '@/shared/hooks';

const {
  showUpgradeModal,
  requiredTier,
  upgradeMessage,
  closeModal,
  handleApiError
} = useSubscriptionGate();

// In API error handler
try {
  await api.post('/endpoint', data);
} catch (error) {
  if (handleApiError(error)) {
    // It was a 402 - modal will show automatically
    return;
  }
  // Handle other errors
  setError(error.message);
}
```

---

## Complete Example

Here's a complete example showing all components working together:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CostBadge, 
  ThresholdIndicator, 
  UomSelect, 
  UpgradeModal 
} from '@/shared/components';
import { useSubscriptionGate } from '@/shared/hooks';
import { UnitOfMeasure } from '@/types/api';
import { apiClient } from '@/lib/api';

export const RecipeCard = ({ recipe }) => {
  const navigate = useNavigate();
  const [uom, setUom] = useState<UnitOfMeasure>('g');
  const {
    showUpgradeModal,
    requiredTier,
    upgradeMessage,
    closeModal,
    handleApiError
  } = useSubscriptionGate();

  const handleDuplicate = async () => {
    try {
      await apiClient.post(`/recipes/${recipe.id}/duplicate`);
    } catch (error) {
      if (!handleApiError(error)) {
        console.error('Failed to duplicate recipe:', error);
      }
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <h3>{recipe.name}</h3>
      
      <div className="flex items-center gap-2 my-2">
        <span>Cost per portion:</span>
        <CostBadge value={recipe.foodCostPerPortion} />
      </div>

      <div className="flex items-center gap-2 my-2">
        <span>Status:</span>
        <ThresholdIndicator 
          foodCostPercentage={recipe.foodCostPercentage}
          threshold={30}
        />
      </div>

      <div className="my-2">
        <label>Unit:</label>
        <UomSelect value={uom} onChange={setUom} />
      </div>

      <button onClick={handleDuplicate}>
        Duplicate Recipe
      </button>

      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={closeModal}
        requiredTier={requiredTier!}
        message={upgradeMessage}
        onUpgrade={() => navigate('/account/subscription')}
      />
    </div>
  );
};
```

---

## Styling Notes

All components use Tailwind-style utility classes consistent with the project's design system:

- **Purple accent**: Primary brand color
- **Red**: Alerts and exceeding indicators
- **Green**: Success and passing indicators
- **Gray**: Neutral states and missing data

Components are designed to be composable and accept custom `className` props for additional styling when needed.
