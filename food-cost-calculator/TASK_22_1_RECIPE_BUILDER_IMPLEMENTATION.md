# Task 22.1: Recipe Builder Page Implementation

## Summary

Successfully implemented the Recipe Builder page with all required features for creating and editing recipes. The page includes comprehensive ingredient line editing, sub-recipe selection, validation, and error handling.

## Implementation Details

### File Modified
- `/food-cost-calculator/frontend/src/features/recipes/RecipeBuilderPage.tsx`

### Features Implemented

#### 1. Recipe Basic Information
- **Recipe Name Input**: Text input with validation (1-100 characters, non-whitespace)
- **Portion Count Input**: Number input with range validation (1-9999)
- **Menu Selling Price Input**: Optional currency input with validation (>0 if set)

#### 2. Ingredient Line Editor
Each ingredient line includes:
- **Type Badge**: Visual indicator showing whether line is an "Ingredient" or "Sub-Recipe"
- **Ingredient/Sub-Recipe Picker**: Dropdown populated from backend API
  - Ingredients show their UOM in parentheses
  - Sub-recipes filtered to exclude current recipe (prevents immediate self-reference)
- **Quantity Input**: Number input with decimal support (step 0.0001, min 0.0001)
- **UOM Selector**: Reusable `UomSelect` component with grouped options
- **Delete Button**: Remove line with visual trash icon
- **Inline Validation Errors**: Field-specific error messages displayed below inputs

#### 3. UOM Compatibility Validation
- Implemented `checkUomCompatibility()` function that:
  - Groups UOMs by dimension (weight, volume, count)
  - Validates ingredient line UOM matches ingredient's purchase UOM dimension
  - Displays inline error: "Incompatible unit: [ingredient name] uses [UOM], cannot convert from [line UOM]"
- Error appears immediately below the UOM selector for the affected line

#### 4. Sub-Recipe Picker with Circular Reference Detection
- Sub-recipe dropdown populated from recipes API
- Filters out current recipe to prevent direct self-reference
- Backend handles transitive circular reference detection via recursive CTE
- Displays circular reference error in alert banner when detected:
  - Error type: HTTP 409
  - Error message extracted from API response
  - Prevents save until resolved

#### 5. Form Validation
Comprehensive client-side validation:
- Recipe name: required, non-empty, non-whitespace, ≤100 chars
- Portion count: required, integer, 1-9999 range
- Menu selling price: optional, must be >0 if set
- Ingredient lines:
  - Quantity required and >0
  - Ingredient/sub-recipe must be selected
  - UOM compatibility check
- All validation errors collected and displayed simultaneously
- Prevents submission until all errors resolved

#### 6. API Integration with React Query
- **Queries**:
  - Fetch ingredients list for current venue
  - Fetch recipes list for sub-recipe picker
  - Fetch existing recipe details when editing
- **Mutations**:
  - Create recipe: `POST /venues/:venueId/recipes`
  - Update recipe: `PATCH /venues/:venueId/recipes/:id`
- **Cache Invalidation**: Invalidates recipes query on success
- **Error Handling**:
  - Circular reference errors (409) → banner alert
  - Field validation errors → inline per-field errors
  - Generic errors → top-level alert

#### 7. Edit Mode Support
- Uses route parameter from `/recipes/:id/edit`
- Populates form with existing recipe data
- Converts API ingredient lines to form state
- Maintains line IDs for updates

#### 8. Empty State UI
- Displays when no ingredient lines added
- Visual empty state with icon and helpful text
- Guides user to add first ingredient/sub-recipe

#### 9. Modern SaaS UI
- Follows existing design system (CSS variables, buttons, forms)
- Responsive grid layout for portion count and menu price
- Card-based sections with clear visual hierarchy
- Color-coded badges for ingredient vs sub-recipe lines
- Smooth transitions and hover effects
- Accessible form labels and error messages
- Loading states with spinner during save

### User Flow

1. **Create New Recipe**: Navigate to `/recipes/new`
2. **Edit Existing Recipe**: Navigate to `/recipes/:id/edit`
3. **Add Ingredient Line**: Click "Add Ingredient" button
4. **Add Sub-Recipe Line**: Click "Add Sub-Recipe" button
5. **Fill Line Details**: Select ingredient/sub-recipe, enter quantity, select UOM
6. **Remove Line**: Click trash icon on unwanted line
7. **Validate**: Real-time validation on form submission
8. **Save**: Submit form → API call → redirect to recipes list on success

### Error Handling Matrix

| Error Type | HTTP Status | Display Location | User Action |
|------------|-------------|------------------|-------------|
| Circular reference | 409 | Top banner alert | Remove problematic sub-recipe |
| Field validation | 400 | Inline below field | Correct invalid value |
| UOM incompatibility | Client-side | Inline below UOM select | Choose compatible UOM |
| Missing selection | Client-side | Inline below dropdown | Select ingredient/sub-recipe |
| Generic API error | Any | Top banner alert | Retry or contact support |

### Technical Architecture

#### State Management
- Local component state (`useState`) for form data
- Zustand store for venue context
- React Query for server state and caching

#### Form State Structure
```typescript
interface RecipeFormData {
  name: string;
  portionCount: string;
  menuSellingPrice: string;
  ingredientLines: IngredientLineForm[];
}

interface IngredientLineForm {
  id: string; // temporary ID for React keys
  type: 'ingredient' | 'subRecipe';
  ingredientId?: string;
  subRecipeId?: string;
  quantityUsed: string;
  unitOfMeasure: UnitOfMeasure;
}
```

#### Validation Logic
- `validateForm()`: Centralized validation function
- `checkUomCompatibility()`: UOM dimension matching
- Error accumulation in `errors` state object
- Field-level error keys: `name`, `portionCount`, `line_${index}_qty`, etc.

### Requirements Coverage

✅ **Requirement 2.1**: Recipe creation with name, portion count, ingredient lines (up to 200)
✅ **Requirement 2.2**: Ingredient line with quantity and UOM specification
✅ **Requirement 2.3**: Sub-recipe as ingredient line support
✅ **Requirement 2.4**: Circular reference detection and error display
✅ **Requirement 2.5**: Recipe editing (name, portion count, lines)
✅ **Requirement 2.10**: Validation (name, portion count, quantity >0)
✅ **Requirement 2.11**: Validation error display with field identification
✅ **Requirement 6.4**: Incompatible UOM error with dimension specification
✅ **Requirement 6.5**: 'each' treated as separate dimension, no conversion

### Design Adherence

✅ Modern SaaS UI with design system consistency
✅ Card-based layout with clear sections
✅ Inline validation errors
✅ Visual feedback (badges, icons, colors)
✅ Responsive button groups
✅ Empty states with helpful guidance
✅ Loading states during async operations
✅ Accessible form elements with labels

## Testing

### Build Verification
```bash
cd food-cost-calculator/frontend
npm run build
```
Result: ✅ Build successful, no TypeScript errors

### Manual Testing Checklist

To fully verify the implementation:

1. **Navigation**
   - [ ] Access `/recipes/new` route
   - [ ] Access `/recipes/:id/edit` with valid recipe ID

2. **Basic Information**
   - [ ] Enter recipe name
   - [ ] Enter portion count (test validation: <1, >9999)
   - [ ] Enter menu selling price (test validation: ≤0)

3. **Ingredient Lines**
   - [ ] Add ingredient line
   - [ ] Select ingredient from dropdown
   - [ ] Enter quantity (test validation: ≤0)
   - [ ] Select UOM
   - [ ] Test incompatible UOM (e.g., select weight ingredient, use volume UOM)
   - [ ] Delete ingredient line

4. **Sub-Recipe Lines**
   - [ ] Add sub-recipe line
   - [ ] Select sub-recipe from dropdown
   - [ ] Verify current recipe not in dropdown (edit mode)
   - [ ] Enter quantity
   - [ ] Test circular reference by creating A→B→A chain

5. **Form Submission**
   - [ ] Submit with empty name → see error
   - [ ] Submit with invalid portion count → see error
   - [ ] Submit with no ingredient lines → should allow
   - [ ] Submit valid form → redirect to /recipes
   - [ ] Edit existing recipe → see populated form
   - [ ] Update recipe → changes saved

6. **Error Handling**
   - [ ] Create circular reference → see banner alert
   - [ ] Enter invalid quantity → see inline error
   - [ ] Select incompatible UOM → see specific error message
   - [ ] Network error → see generic error alert

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/venues/:venueId/ingredients` | Fetch ingredients for picker |
| GET | `/venues/:venueId/recipes` | Fetch recipes for sub-recipe picker |
| GET | `/venues/:venueId/recipes/:id` | Fetch recipe details for editing |
| POST | `/venues/:venueId/recipes` | Create new recipe |
| PATCH | `/venues/:venueId/recipes/:id` | Update existing recipe |

## Next Steps

For complete integration:

1. **Backend Verification**: Ensure recipe endpoints handle all payload fields
2. **Manual Testing**: Run through testing checklist above
3. **Edge Cases**: Test with 200 ingredient lines (requirement limit)
4. **Performance**: Test dropdown performance with large ingredient/recipe lists
5. **Accessibility**: Screen reader testing for form validation
6. **Mobile**: Test responsive layout on mobile devices

## Known Limitations

1. No ingredient search/filter in dropdown (future enhancement)
2. No drag-and-drop line reordering (not in requirements)
3. No bulk ingredient import (not in requirements)
4. No recipe preview/cost calculation display in builder (shown in detail view)

## Files Changed

1. `/food-cost-calculator/frontend/src/features/recipes/RecipeBuilderPage.tsx` - Complete implementation

## Dependencies

No new dependencies added. Uses existing:
- react, react-router-dom
- @tanstack/react-query
- axios
- zustand
- Existing shared components: UomSelect

## Conclusion

The Recipe Builder page is fully implemented according to task 22.1 requirements. It provides a comprehensive, user-friendly interface for creating and editing recipes with proper validation, error handling, and integration with the backend API. The implementation follows the existing design system and code patterns established in the project.
