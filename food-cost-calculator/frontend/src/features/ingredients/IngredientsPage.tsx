import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useVenueStore } from '../../store/venueSlice';
import { UomSelect } from '../../shared/components/UomSelect';
import { CostBadge } from '../../shared/components/CostBadge';
import type { Ingredient, UnitOfMeasure } from '../../types/api';

interface IngredientFormData {
  name: string;
  purchasePrice: string;
  purchaseQuantity: string;
  unitOfMeasure: UnitOfMeasure;
  yieldPercentage: string;
}

interface DeleteConflictError {
  error_code: string;
  message: string;
  details?: {
    affected_resources?: string[];
  };
}

export const IngredientsPage = () => {
  const currentVenueId = useVenueStore((state) => state.currentVenueId);
  const queryClient = useQueryClient();

  // Search state with debouncing
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Form state
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [formData, setFormData] = useState<IngredientFormData>({
    name: '',
    purchasePrice: '',
    purchaseQuantity: '',
    unitOfMeasure: 'g',
    yieldPercentage: '100',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    ingredient: Ingredient;
    affectedRecipes?: string[];
    confirmed?: boolean;
  } | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch ingredients with search
  const { data: ingredients = [], isLoading, error } = useQuery({
    queryKey: ['ingredients', currentVenueId, debouncedSearchQuery],
    queryFn: async () => {
      const params = debouncedSearchQuery ? { q: debouncedSearchQuery } : {};
      const response = await apiClient.get<Ingredient[]>(
        `/venues/${currentVenueId}/ingredients`,
        { params }
      );
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  // Create ingredient mutation
  const createMutation = useMutation({
    mutationFn: async (data: Omit<Ingredient, 'id' | 'venueId' | 'costPerUnit' | 'effectiveCostPerUsableUnit' | 'createdAt' | 'updatedAt'>) => {
      const response = await apiClient.post<Ingredient>(
        `/venues/${currentVenueId}/ingredients`,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients', currentVenueId] });
      resetForm();
    },
    onError: (error: any) => {
      handleFormError(error);
    },
  });

  // Update ingredient mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Ingredient> }) => {
      const response = await apiClient.patch<Ingredient>(
        `/venues/${currentVenueId}/ingredients/${id}`,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients', currentVenueId] });
      resetForm();
    },
    onError: (error: any) => {
      handleFormError(error);
    },
  });

  // Delete ingredient mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ id, confirmed }: { id: string; confirmed?: boolean }) => {
      const params = confirmed ? { confirmed: 'true' } : {};
      await apiClient.delete(`/venues/${currentVenueId}/ingredients/${id}`, { params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients', currentVenueId] });
      setDeleteConfirmation(null);
    },
    onError: (error: any) => {
      // Check for delete conflict (409)
      if (error.response?.status === 409) {
        const conflictData = error.response.data as DeleteConflictError;
        if (deleteConfirmation) {
          setDeleteConfirmation({
            ...deleteConfirmation,
            affectedRecipes: conflictData.details?.affected_resources || [],
          });
        }
      }
    },
  });

  const handleFormError = (error: any) => {
    if (error.response?.data?.errors) {
      setFormErrors(error.response.data.errors);
    } else if (error.response?.data?.message) {
      setFormErrors({ general: error.response.data.message });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      purchasePrice: '',
      purchaseQuantity: '',
      unitOfMeasure: 'g',
      yieldPercentage: '100',
    });
    setFormErrors({});
    setIsFormVisible(false);
    setEditingIngredient(null);
  };

  const handleEdit = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient);
    setFormData({
      name: ingredient.name,
      purchasePrice: ingredient.purchasePrice.toString(),
      purchaseQuantity: ingredient.purchaseQuantity.toString(),
      unitOfMeasure: ingredient.unitOfMeasure,
      yieldPercentage: ingredient.yieldPercentage.toString(),
    });
    setFormErrors({});
    setIsFormVisible(true);
  };

  const handleDelete = (ingredient: Ingredient) => {
    setDeleteConfirmation({ ingredient });
  };

  const confirmDelete = () => {
    if (deleteConfirmation) {
      deleteMutation.mutate({
        id: deleteConfirmation.ingredient.id,
        confirmed: deleteConfirmation.affectedRecipes ? true : undefined,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    // Basic validation
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }
    if (!formData.purchasePrice || parseFloat(formData.purchasePrice) <= 0) {
      errors.purchasePrice = 'Purchase price must be greater than 0';
    }
    if (!formData.purchaseQuantity || parseFloat(formData.purchaseQuantity) <= 0) {
      errors.purchaseQuantity = 'Purchase quantity must be greater than 0';
    }
    if (!formData.yieldPercentage || parseFloat(formData.yieldPercentage) < 1 || parseFloat(formData.yieldPercentage) > 100) {
      errors.yieldPercentage = 'Yield percentage must be between 1 and 100';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const ingredientData = {
      name: formData.name.trim(),
      purchasePrice: parseFloat(formData.purchasePrice),
      purchaseQuantity: parseFloat(formData.purchaseQuantity),
      unitOfMeasure: formData.unitOfMeasure,
      yieldPercentage: parseFloat(formData.yieldPercentage),
    };

    if (editingIngredient) {
      updateMutation.mutate({
        id: editingIngredient.id,
        data: ingredientData,
      });
    } else {
      createMutation.mutate(ingredientData);
    }
  };

  // Sort ingredients alphabetically by name
  const sortedIngredients = useMemo(() => {
    return [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients]);

  if (!currentVenueId) {
    return (
      <div className="p-6">
        <div className="alert alert-warning">
          <span>Please select a venue to manage ingredients.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Ingredient Library</h1>
        <p className="text-gray-600">
          Manage your ingredient costs and pricing for accurate recipe calculations.
        </p>
      </div>

      {/* Search and Add Button */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'row', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 auto', maxWidth: '28rem' }}>
          <input
            type="text"
            placeholder="Search ingredients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input"
          />
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsFormVisible(true);
          }}
          className="btn btn-primary"
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Ingredient
        </button>
      </div>

      {/* Inline Form */}
      {isFormVisible && (
        <div className="card mb-6 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {editingIngredient ? 'Edit Ingredient' : 'New Ingredient'}
            </h3>
            <button
              onClick={resetForm}
              className="text-gray-500 hover:text-gray-700"
              aria-label="Close form"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {formErrors.general && (
            <div className="alert alert-error mb-4">
              <span>{formErrors.general}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              {/* Name */}
              <div className="lg:col-span-2">
                <label htmlFor="name" className="form-label">
                  Ingredient Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`form-input ${formErrors.name ? 'error' : ''}`}
                  placeholder="e.g., Chicken Breast"
                  maxLength={100}
                />
                {formErrors.name && <span className="form-error">{formErrors.name}</span>}
              </div>

              {/* Purchase Price */}
              <div>
                <label htmlFor="purchasePrice" className="form-label">
                  Purchase Price ($)
                </label>
                <input
                  id="purchasePrice"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                  className={`form-input ${formErrors.purchasePrice ? 'error' : ''}`}
                  placeholder="0.00"
                />
                {formErrors.purchasePrice && <span className="form-error">{formErrors.purchasePrice}</span>}
              </div>

              {/* Purchase Quantity */}
              <div>
                <label htmlFor="purchaseQuantity" className="form-label">
                  Purchase Quantity
                </label>
                <input
                  id="purchaseQuantity"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={formData.purchaseQuantity}
                  onChange={(e) => setFormData({ ...formData, purchaseQuantity: e.target.value })}
                  className={`form-input ${formErrors.purchaseQuantity ? 'error' : ''}`}
                  placeholder="1.0"
                />
                {formErrors.purchaseQuantity && <span className="form-error">{formErrors.purchaseQuantity}</span>}
              </div>

              {/* Unit of Measure */}
              <div>
                <label htmlFor="unitOfMeasure" className="form-label">
                  Unit
                </label>
                <UomSelect
                  id="unitOfMeasure"
                  value={formData.unitOfMeasure}
                  onChange={(value) => setFormData({ ...formData, unitOfMeasure: value })}
                />
              </div>
            </div>

            {/* Yield Percentage */}
            <div className="mb-4">
              <label htmlFor="yieldPercentage" className="form-label">
                Yield Percentage (%)
              </label>
              <input
                id="yieldPercentage"
                type="number"
                step="0.01"
                min="1"
                max="100"
                value={formData.yieldPercentage}
                onChange={(e) => setFormData({ ...formData, yieldPercentage: e.target.value })}
                className={`form-input max-w-xs ${formErrors.yieldPercentage ? 'error' : ''}`}
                placeholder="100"
              />
              <span className="form-hint">
                The usable percentage after preparation (default: 100%)
              </span>
              {formErrors.yieldPercentage && <span className="form-error">{formErrors.yieldPercentage}</span>}
            </div>

            {/* Form Actions */}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <span className="spinner"></span>
                    Saving...
                  </>
                ) : (
                  <>{editingIngredient ? 'Update' : 'Create'} Ingredient</>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ingredients Table */}
      <div className="card">
        {error && (
          <div className="alert alert-error mb-4">
            <span>Failed to load ingredients. Please try again.</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
            <span className="ml-3 text-gray-600">Loading ingredients...</span>
          </div>
        ) : sortedIngredients.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No ingredients found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchQuery ? 'Try a different search term.' : 'Get started by creating a new ingredient.'}
            </p>
          </div>
        ) : (
          <div style={{ overflow: 'auto', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}>
                <tr>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Name
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Purchase Price
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Quantity
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Unit
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Yield %
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Cost/Unit
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Effective Cost
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ background: 'white' }}>
                {sortedIngredients.map((ingredient, index) => (
                  <tr 
                    key={ingredient.id} 
                    style={{ 
                      background: index % 2 === 0 ? 'white' : '#f9fafb',
                      transition: 'background-color 0.15s',
                      borderTop: '1px solid #e5e7eb'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#eff6ff'}
                    onMouseLeave={(e) => e.currentTarget.style.background = index % 2 === 0 ? 'white' : '#f9fafb'}
                  >
                    <td style={{ padding: '1.25rem 1.5rem', borderRight: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827' }}>{ingredient.name}</div>
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>
                      <CostBadge value={ingredient.purchasePrice} />
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', fontSize: '0.875rem', color: '#111827', borderRight: '1px solid #e5e7eb' }}>
                      {Number(ingredient.purchaseQuantity).toFixed(2)}
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center', borderRight: '1px solid #e5e7eb' }}>
                      <span style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: '600', color: '#374151', background: '#f3f4f6', borderRadius: '0.375rem', display: 'inline-block' }}>
                        {ingredient.unitOfMeasure}
                      </span>
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center', fontSize: '0.875rem', color: '#111827', borderRight: '1px solid #e5e7eb' }}>
                      <span style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: '600', background: '#dbeafe', color: '#1e40af', borderRadius: '0.375rem', display: 'inline-block' }}>
                        {Number(ingredient.yieldPercentage).toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>
                      <CostBadge value={ingredient.costPerUnit} decimals={4} />
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>
                      <CostBadge value={ingredient.effectiveCostPerUsableUnit} decimals={4} />
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleEdit(ingredient)}
                          style={{ color: '#2563eb', cursor: 'pointer', background: 'transparent', border: 'none', padding: '0.25rem' }}
                          title="Edit ingredient"
                          onMouseEnter={(e) => e.currentTarget.style.color = '#1d4ed8'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#2563eb'}
                        >
                          <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(ingredient)}
                          style={{ color: '#dc2626', cursor: 'pointer', background: 'transparent', border: 'none', padding: '0.25rem' }}
                          title="Delete ingredient"
                          onMouseEnter={(e) => e.currentTarget.style.color = '#b91c1c'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#dc2626'}
                        >
                          <svg style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 fade-in">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 slide-in-right">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  Delete Ingredient
                </h3>
                <div className="mt-2 text-sm text-gray-500">
                  <p>
                    Are you sure you want to delete <strong>{deleteConfirmation.ingredient.name}</strong>?
                  </p>
                  {deleteConfirmation.affectedRecipes && deleteConfirmation.affectedRecipes.length > 0 && (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                      <p className="font-medium text-yellow-800 mb-2">
                        ⚠️ This ingredient is used in the following recipes:
                      </p>
                      <ul className="list-disc list-inside text-yellow-700">
                        {deleteConfirmation.affectedRecipes.map((recipeName, index) => (
                          <li key={index}>{recipeName}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-yellow-700">
                        Deleting this ingredient will affect these recipes' cost calculations.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmation(null)}
                className="btn btn-secondary"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="btn btn-primary"
                style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <>
                    <span className="spinner"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete Ingredient'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
