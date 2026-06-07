# Ingredient API Response Format Fix

## Issue
Frontend displayed error: `Cannot read properties of undefined (reading 'toFixed')` when loading ingredients list.

### Root Cause
- **Backend**: Returns snake_case field names (`purchase_price`, `purchase_quantity`) and string values (`"3.20"`, `"2.0000"`)
- **Frontend**: Expects camelCase field names (`purchasePrice`, `purchaseQuantity`) and numeric values

The error occurred at line 799 of `IngredientsPage.tsx` when trying to call `.toFixed()` on `ingredient.purchaseQuantity` which was undefined (API returns `purchase_quantity`).

## Solution
Added Axios response interceptor in `/frontend/src/lib/api.ts` to:
1. Transform all snake_case keys to camelCase recursively
2. Convert string numbers to actual numbers automatically

### Implementation Details

```typescript
// Helper functions added to api.ts
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformKeys(obj: any): any {
  // Recursively transforms:
  // - snake_case keys → camelCase keys
  // - String numbers → numeric values
  // Works on objects, arrays, and nested structures
}
```

The interceptor runs on every API response, ensuring consistent data format throughout the frontend.

## Testing
Verified transformation with sample API response:
- Input: `{"purchase_price": "3.20", "purchase_quantity": "2.0000"}`
- Output: `{purchasePrice: 3.2, purchaseQuantity: 2}`

## Files Modified
- `/Users/vicky/cogschecker/food-cost-calculator/frontend/src/lib/api.ts`

## Result
✅ Frontend can now:
- Access fields using camelCase naming
- Call numeric methods like `.toFixed()` without errors
- Display ingredients list successfully
- Create, edit, and delete ingredients without issues

## Alternative Considered
Could have changed backend Jackson configuration from `SNAKE_CASE` to `camelCase`, but this would:
- Require updating all frontend code already using snake_case
- Break API contract if external clients exist
- Need database column naming changes

The frontend interceptor approach is:
- Non-breaking for backend
- Transparent to frontend components
- Centralized in one location
- Easy to maintain
