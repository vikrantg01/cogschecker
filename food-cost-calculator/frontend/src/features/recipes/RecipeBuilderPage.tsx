import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useVenueStore } from '../../store/venueSlice';
import { UomSelect } from '../../shared/components/UomSelect';
import type { 
  Recipe, 
  Ingredient, 
  UnitOfMeasure,
  ApiError,
  RecipeWithDetails 
} from '../../types/api';

interface IngredientLineForm {
  id: string; // temporary ID for form management
  type: 'ingredient' | 'subRecipe';
  ingredientId?: string;
  subRecipeId?: string;
  quantityUsed: string;
  unitOfMeasure: UnitOfMeasure;
  error?: string;
}

interface RecipeFormData {
  name: string;
  portionCount: string;
  menuSellingPrice: string;
  ingredientLines: IngredientLineForm[];
}

export const RecipeBuilderPage = () => {
  const navigate = useNavigate();
  const { id: recipeId } = useParams<{ id: string }>();
  const currentVenueId = useVenueStore((state) => state.currentVenueId);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<RecipeFormData>({
    name: '',
    portionCount: '1',
    menuSellingPrice: '',
    ingredientLines: [],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [circularRefError, setCircularRefError] = useState<string | null>(null);

  // Fetch ingredients for the dropdown
  const { data: ingredients = [] } = useQuery<Ingredient[]>({
    queryKey: ['ingredients', currentVenueId],
    queryFn: async () => {
      const response = await apiClient.get(`/venues/${currentVenueId}/ingredients`);
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  // Fetch recipes for sub-recipe picker
  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ['recipes', currentVenueId],
    queryFn: async () => {
      const response = await apiClient.get(`/venues/${currentVenueId}/recipes`);
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  // Fetch existing recipe if editing
  const { data: existingRecipe } = useQuery<RecipeWithDetails>({
    queryKey: ['recipe', recipeId],
    queryFn: async () => {
      const response = await apiClient.get(`/venues/${currentVenueId}/recipes/${recipeId}`);
      return response.data;
    },
    enabled: !!recipeId && !!currentVenueId,
  });

  // Populate form when editing
  useEffect(() => {
    if (existingRecipe) {
      const initialData = {
        name: existingRecipe.name,
        portionCount: existingRecipe.portionCount.toString(),
        menuSellingPrice: existingRecipe.menuSellingPrice?.toString() || '',
        ingredientLines: existingRecipe.ingredientLines?.map((line) => ({
          id: line.id,
          type: (line.ingredientId ? 'ingredient' : 'subRecipe') as 'ingredient' | 'subRecipe',
          ingredientId: line.ingredientId,
          subRecipeId: line.subRecipeId,
          quantityUsed: line.quantityUsed.toString(),
          unitOfMeasure: line.unitOfMeasure,
        })) || [],
      };
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => setFormData(initialData), 0);
    }
  }, [existingRecipe]);

  // Save/Create mutation
  const saveMutation = useMutation({
    mutationFn: async (data: RecipeFormData) => {
      const payload = {
        name: data.name.trim(),
        portionCount: parseInt(data.portionCount, 10),
        menuSellingPrice: data.menuSellingPrice ? parseFloat(data.menuSellingPrice) : null,
        ingredientLines: data.ingredientLines.map((line) => ({
          ingredientId: line.type === 'ingredient' ? line.ingredientId : null,
          subRecipeId: line.type === 'subRecipe' ? line.subRecipeId : null,
          quantityUsed: parseFloat(line.quantityUsed),
          unitOfMeasure: line.unitOfMeasure,
        })),
      };

      if (recipeId) {
        const response = await apiClient.patch(`/venues/${currentVenueId}/recipes/${recipeId}`, payload);
        return response.data;
      } else {
        const response = await apiClient.post(`/venues/${currentVenueId}/recipes`, payload);
        return response.data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      navigate('/recipes');
    },
    onError: (error: unknown) => {
      const errorResponse = error as { response?: { status?: number; data?: ApiError } };
      const apiError = errorResponse.response?.data;
      
      // Check for circular reference error (409)
      if (errorResponse.response?.status === 409 && apiError?.message?.toLowerCase().includes('circular')) {
        setCircularRefError(apiError.message || 'Circular reference detected in sub-recipe selection');
      } else if (apiError?.errors) {
        // Field validation errors
        setErrors(Object.fromEntries(
          Object.entries(apiError.errors).map(([key, messages]) => [key, messages[0]])
        ));
      } else {
        setSaveError(apiError?.message || 'Failed to save recipe');
      }
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Recipe name is required';
    } else if (formData.name.trim().length > 100) {
      newErrors.name = 'Recipe name must be 100 characters or less';
    }

    // Portion count validation
    const portionCount = parseInt(formData.portionCount, 10);
    if (!formData.portionCount || isNaN(portionCount)) {
      newErrors.portionCount = 'Portion count is required';
    } else if (portionCount < 1 || portionCount > 9999) {
      newErrors.portionCount = 'Portion count must be between 1 and 9999';
    }

    // Menu selling price validation (optional, but must be > 0 if set)
    if (formData.menuSellingPrice) {
      const price = parseFloat(formData.menuSellingPrice);
      if (isNaN(price) || price <= 0) {
        newErrors.menuSellingPrice = 'Menu price must be greater than 0';
      }
    }

    // Ingredient line validation
    formData.ingredientLines.forEach((line, index) => {
      const qty = parseFloat(line.quantityUsed);
      if (!line.quantityUsed || isNaN(qty) || qty <= 0) {
        newErrors[`line_${index}_qty`] = 'Quantity must be greater than 0';
      }

      if (line.type === 'ingredient' && !line.ingredientId) {
        newErrors[`line_${index}_ingredient`] = 'Please select an ingredient';
      }

      if (line.type === 'subRecipe' && !line.subRecipeId) {
        newErrors[`line_${index}_subRecipe`] = 'Please select a sub-recipe';
      }

      // Check for UOM compatibility
      if (line.type === 'ingredient' && line.ingredientId) {
        const ingredient = ingredients.find((i) => i.id === line.ingredientId);
        if (ingredient) {
          const compatible = checkUomCompatibility(line.unitOfMeasure, ingredient.unitOfMeasure);
          if (!compatible) {
            newErrors[`line_${index}_uom`] = `Incompatible unit: ${ingredient.name} uses ${ingredient.unitOfMeasure}, cannot convert from ${line.unitOfMeasure}`;
          }
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkUomCompatibility = (lineUom: UnitOfMeasure, ingredientUom: UnitOfMeasure): boolean => {
    const weightUnits: UnitOfMeasure[] = ['g', 'kg', 'oz', 'lb'];
    const volumeUnits: UnitOfMeasure[] = ['ml', 'L', 'tsp', 'tbsp', 'cup'];
    const countUnits: UnitOfMeasure[] = ['each'];

    const getDimension = (uom: UnitOfMeasure): string => {
      if (weightUnits.includes(uom)) return 'weight';
      if (volumeUnits.includes(uom)) return 'volume';
      if (countUnits.includes(uom)) return 'count';
      return 'unknown';
    };

    return getDimension(lineUom) === getDimension(ingredientUom);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setCircularRefError(null);

    if (validateForm()) {
      saveMutation.mutate(formData);
    }
  };

  const addIngredientLine = () => {
    setFormData({
      ...formData,
      ingredientLines: [
        ...formData.ingredientLines,
        {
          id: `temp_${Date.now()}`,
          type: 'ingredient',
          quantityUsed: '',
          unitOfMeasure: 'g',
        },
      ],
    });
  };

  const addSubRecipeLine = () => {
    setFormData({
      ...formData,
      ingredientLines: [
        ...formData.ingredientLines,
        {
          id: `temp_${Date.now()}`,
          type: 'subRecipe',
          quantityUsed: '',
          unitOfMeasure: 'each',
        },
      ],
    });
  };

  const removeLine = (index: number) => {
    setFormData({
      ...formData,
      ingredientLines: formData.ingredientLines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, updates: Partial<IngredientLineForm>) => {
    const newLines = [...formData.ingredientLines];
    newLines[index] = { ...newLines[index], ...updates };
    setFormData({ ...formData, ingredientLines: newLines });
  };

  // Filter out current recipe from sub-recipe list to prevent immediate self-reference
  const availableSubRecipes = recipes.filter((r) => r.id !== recipeId);

  return (
    <div className="recipe-builder-page" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-3xl font-bold" style={{ marginBottom: '0.5rem' }}>
          {recipeId ? 'Edit Recipe' : 'Create Recipe'}
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          {recipeId ? 'Update your recipe details and ingredients' : 'Build a new recipe by adding ingredients and setting portions'}
        </p>
      </div>

      {/* Global Errors */}
      {saveError && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{saveError}</span>
        </div>
      )}

      {circularRefError && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{circularRefError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Recipe Basic Info Card */}
        <div className="card card-lg" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Basic Information</h3>

          <div className="form-group">
            <label htmlFor="recipeName" className="form-label">
              Recipe Name *
            </label>
            <input
              id="recipeName"
              type="text"
              className={`form-input ${errors.name ? 'error' : ''}`}
              placeholder="e.g., Marinara Sauce, Caesar Salad"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              maxLength={100}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="portionCount" className="form-label">
                Portion Count *
              </label>
              <input
                id="portionCount"
                type="number"
                min="1"
                max="9999"
                className={`form-input ${errors.portionCount ? 'error' : ''}`}
                placeholder="e.g., 4"
                value={formData.portionCount}
                onChange={(e) => setFormData({ ...formData, portionCount: e.target.value })}
              />
              {errors.portionCount && <span className="form-error">{errors.portionCount}</span>}
              <span className="form-hint">Number of servings this recipe yields</span>
            </div>

            <div className="form-group">
              <label htmlFor="menuPrice" className="form-label">
                Menu Selling Price (optional)
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ 
                  position: 'absolute', 
                  left: '1rem', 
                  top: '50%', 
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  fontWeight: '500'
                }}>
                  $
                </span>
                <input
                  id="menuPrice"
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={`form-input ${errors.menuSellingPrice ? 'error' : ''}`}
                  style={{ paddingLeft: '2rem' }}
                  placeholder="0.00"
                  value={formData.menuSellingPrice}
                  onChange={(e) => setFormData({ ...formData, menuSellingPrice: e.target.value })}
                />
              </div>
              {errors.menuSellingPrice && <span className="form-error">{errors.menuSellingPrice}</span>}
              <span className="form-hint">Price charged to customers</span>
            </div>
          </div>
        </div>

        {/* Ingredient Lines Card */}
        <div className="card card-lg" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem' }}>Ingredients & Sub-Recipes</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={addIngredientLine}
                className="btn btn-secondary btn-sm"
              >
                <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Ingredient
              </button>
              <button
                type="button"
                onClick={addSubRecipeLine}
                className="btn btn-secondary btn-sm"
              >
                <svg style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Sub-Recipe
              </button>
            </div>
          </div>

          {formData.ingredientLines.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '3rem 1rem',
              color: 'var(--text-tertiary)',
              background: 'var(--bg-secondary)',
              borderRadius: '0.5rem',
              border: '2px dashed var(--border-light)'
            }}>
              <svg style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', opacity: '0.5' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p style={{ fontWeight: '500', marginBottom: '0.5rem' }}>No ingredients added yet</p>
              <p style={{ fontSize: '0.875rem' }}>Start by adding ingredients or sub-recipes to your recipe</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formData.ingredientLines.map((line, index) => (
                <div
                  key={line.id}
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-secondary)',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border-light)',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    {/* Type Indicator */}
                    <div style={{ flex: '0 0 auto', paddingTop: '0.5rem' }}>
                      <span className="badge" style={{
                        background: line.type === 'ingredient' ? 'var(--primary-100)' : 'var(--warning-light)',
                        color: line.type === 'ingredient' ? 'var(--primary-700)' : '#92400e',
                        fontSize: '0.6875rem',
                        padding: '0.25rem 0.5rem'
                      }}>
                        {line.type === 'ingredient' ? 'Ingredient' : 'Sub-Recipe'}
                      </span>
                    </div>

                    {/* Ingredient/Sub-Recipe Selector */}
                    <div style={{ flex: '2', minWidth: '0' }}>
                      <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                        {line.type === 'ingredient' ? 'Ingredient' : 'Sub-Recipe'}
                      </label>
                      <select
                        className={`form-input ${errors[`line_${index}_${line.type === 'ingredient' ? 'ingredient' : 'subRecipe'}`] ? 'error' : ''}`}
                        value={line.type === 'ingredient' ? line.ingredientId || '' : line.subRecipeId || ''}
                        onChange={(e) => {
                          if (line.type === 'ingredient') {
                            updateLine(index, { ingredientId: e.target.value });
                          } else {
                            updateLine(index, { subRecipeId: e.target.value });
                          }
                        }}
                        style={{ fontSize: '0.875rem' }}
                      >
                        <option value="">Select {line.type === 'ingredient' ? 'an ingredient' : 'a sub-recipe'}...</option>
                        {line.type === 'ingredient'
                          ? ingredients.map((ing) => (
                              <option key={ing.id} value={ing.id}>
                                {ing.name} ({ing.unitOfMeasure})
                              </option>
                            ))
                          : availableSubRecipes.map((recipe) => (
                              <option key={recipe.id} value={recipe.id}>
                                {recipe.name}
                              </option>
                            ))}
                      </select>
                      {errors[`line_${index}_${line.type === 'ingredient' ? 'ingredient' : 'subRecipe'}`] && (
                        <span className="form-error">{errors[`line_${index}_${line.type === 'ingredient' ? 'ingredient' : 'subRecipe'}`]}</span>
                      )}
                    </div>

                    {/* Quantity */}
                    <div style={{ flex: '1', minWidth: '100px' }}>
                      <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                        Quantity
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        className={`form-input ${errors[`line_${index}_qty`] ? 'error' : ''}`}
                        placeholder="0.00"
                        value={line.quantityUsed}
                        onChange={(e) => updateLine(index, { quantityUsed: e.target.value })}
                        style={{ fontSize: '0.875rem' }}
                      />
                      {errors[`line_${index}_qty`] && (
                        <span className="form-error">{errors[`line_${index}_qty`]}</span>
                      )}
                    </div>

                    {/* UOM */}
                    <div style={{ flex: '1', minWidth: '120px' }}>
                      <label className="form-label" style={{ fontSize: '0.8125rem' }}>
                        Unit
                      </label>
                      <UomSelect
                        value={line.unitOfMeasure}
                        onChange={(uom) => updateLine(index, { unitOfMeasure: uom })}
                        className={errors[`line_${index}_uom`] ? 'error' : ''}
                      />
                      {errors[`line_${index}_uom`] && (
                        <span className="form-error" style={{ fontSize: '0.75rem' }}>
                          {errors[`line_${index}_uom`]}
                        </span>
                      )}
                    </div>

                    {/* Delete Button */}
                    <div style={{ flex: '0 0 auto', paddingTop: '1.75rem' }}>
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="btn btn-ghost"
                        style={{ 
                          padding: '0.5rem',
                          color: 'var(--error)',
                          minWidth: 'auto'
                        }}
                        title="Remove line"
                      >
                        <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => navigate('/recipes')}
            className="btn btn-secondary"
            disabled={saveMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" />
                Saving...
              </span>
            ) : (
              <>
                <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {recipeId ? 'Update Recipe' : 'Create Recipe'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
