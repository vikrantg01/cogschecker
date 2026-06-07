import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useVenueStore } from '../../store/venueSlice';
import { CostBadge } from '../../shared/components/CostBadge';
import { ThresholdIndicator } from '../../shared/components/ThresholdIndicator';
import type { Recipe } from '../../types/api';

interface DeleteConflictError {
  error_code: string;
  message: string;
  details?: {
    affected_resources?: string[];
  };
}

export const RecipesPage = () => {
  const navigate = useNavigate();
  const currentVenueId = useVenueStore((state) => state.currentVenueId);
  const queryClient = useQueryClient();

  // Search state with debouncing
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    recipe: Recipe;
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

  // Fetch recipes with search
  const { data: recipes = [], isLoading, error } = useQuery({
    queryKey: ['recipes', currentVenueId, debouncedSearchQuery],
    queryFn: async () => {
      const params = debouncedSearchQuery ? { q: debouncedSearchQuery } : {};
      const response = await apiClient.get<Recipe[]>(
        `/venues/${currentVenueId}/recipes`,
        { params }
      );
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  // Fetch venue config for threshold
  const { data: venueConfig } = useQuery({
    queryKey: ['config', currentVenueId],
    queryFn: async () => {
      const response = await apiClient.get(`/venues/${currentVenueId}/config`);
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  const threshold = venueConfig?.targetFoodCostPercentage ?? 30.0;

  // Duplicate recipe mutation
  const duplicateMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      const response = await apiClient.post<Recipe>(
        `/venues/${currentVenueId}/recipes/${recipeId}/duplicate`
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recipes', currentVenueId] });
      // Navigate to edit the duplicated recipe
      navigate(`/recipes/${data.id}/edit`);
    },
    onError: (error: any) => {
      console.error('Failed to duplicate recipe:', error);
    },
  });

  // Delete recipe mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ id, confirmed }: { id: string; confirmed?: boolean }) => {
      const params = confirmed ? { confirmed: 'true' } : {};
      await apiClient.delete(`/venues/${currentVenueId}/recipes/${id}`, { params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', currentVenueId] });
      setDeleteConfirmation(null);
    },
    onError: (error: any) => {
      // Check for delete conflict (409) - used as sub-recipe
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

  const handleView = (recipeId: string) => {
    navigate(`/recipes/${recipeId}`);
  };

  const handleEdit = (recipeId: string) => {
    navigate(`/recipes/${recipeId}/edit`);
  };

  const handleDuplicate = (recipeId: string) => {
    duplicateMutation.mutate(recipeId);
  };

  const handleDelete = (recipe: Recipe) => {
    setDeleteConfirmation({ recipe });
  };

  const confirmDelete = () => {
    if (deleteConfirmation) {
      deleteMutation.mutate({
        id: deleteConfirmation.recipe.id,
        confirmed: deleteConfirmation.affectedRecipes ? true : undefined,
      });
    }
  };

  // Sort recipes alphabetically by name
  const sortedRecipes = useMemo(() => {
    return [...recipes].sort((a, b) => a.name.localeCompare(b.name));
  }, [recipes]);

  if (!currentVenueId) {
    return (
      <div className="p-6">
        <div className="alert alert-warning">
          <span>Please select a venue to manage recipes.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Recipe Library</h1>
        <p className="text-gray-600">
          Manage your recipes and track food costs for accurate profitability analysis.
        </p>
      </div>

      {/* Search and Add Button */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'row', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 auto', maxWidth: '28rem' }}>
          <input
            type="text"
            placeholder="Search recipes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input"
          />
        </div>
        <button
          onClick={() => navigate('/recipes/new')}
          className="btn btn-primary"
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Recipe
        </button>
      </div>

      {/* Recipes Table */}
      <div className="card shadow-md">
        {error && (
          <div className="alert alert-error mb-4">
            <span>Failed to load recipes. Please try again.</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="spinner" style={{ width: '2.5rem', height: '2.5rem' }}></span>
            <span className="ml-4 text-gray-600 text-lg font-medium">Loading recipes...</span>
          </div>
        ) : sortedRecipes.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No recipes found</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              {searchQuery ? 'Try a different search term.' : 'Get started by creating a new recipe.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => navigate('/recipes/new')}
                className="btn btn-primary"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Your First Recipe
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflow: 'auto', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}>
                <tr>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Recipe Name
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Portions
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Food Cost
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Menu Price
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Cost %
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid rgba(255,255,255,0.2)' }}>
                    Status
                  </th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: '700', color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ background: 'white' }}>
                {sortedRecipes.map((recipe, index) => (
                  <tr 
                    key={recipe.id} 
                    style={{ 
                      background: index % 2 === 0 ? 'white' : '#f9fafb',
                      transition: 'background-color 0.15s',
                      borderTop: '1px solid #e5e7eb'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#eff6ff'}
                    onMouseLeave={(e) => e.currentTarget.style.background = index % 2 === 0 ? 'white' : '#f9fafb'}
                  >
                    <td style={{ padding: '1.25rem 1.5rem', borderRight: '1px solid #e5e7eb' }}>
                      <div 
                        style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => handleView(recipe.id)}
                        title={recipe.name}
                      >
                        {recipe.name}
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center', borderRight: '1px solid #e5e7eb' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.375rem 0.75rem', minWidth: '3rem', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: '600', background: '#dbeafe', color: '#1e3a8a' }}>
                        {recipe.portionCount}
                      </span>
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>
                      <CostBadge value={recipe.foodCostPerPortion} />
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right', borderRight: '1px solid #e5e7eb' }}>
                      <CostBadge value={recipe.menuSellingPrice} />
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center', borderRight: '1px solid #e5e7eb' }}>
                      {recipe.foodCostPercentage !== null && recipe.foodCostPercentage !== undefined ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.375rem 0.75rem', minWidth: '4rem', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: '700', fontFamily: 'monospace', background: '#e0e7ff', color: '#312e81' }}>
                          {recipe.foodCostPercentage.toFixed(1)}%
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.375rem 0.75rem', minWidth: '4rem', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'monospace', background: '#f3f4f6', color: '#9ca3af' }}>N/A</span>
                      )}
                    </td>
                    <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center', borderRight: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <ThresholdIndicator 
                          foodCostPercentage={recipe.foodCostPercentage}
                          threshold={threshold}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleView(recipe.id)}
                          className="btn btn-sm btn-primary"
                          title="View recipe"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(recipe.id)}
                          className="btn btn-sm btn-secondary"
                          title="Edit recipe"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDuplicate(recipe.id)}
                          className="btn btn-sm btn-success"
                          title="Duplicate recipe"
                          disabled={duplicateMutation.isPending}
                        >
                          {duplicateMutation.isPending && duplicateMutation.variables === recipe.id ? (
                            <span className="spinner" style={{ width: '1rem', height: '1rem' }}></span>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(recipe)}
                          className="btn btn-sm btn-danger"
                          title="Delete recipe"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
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
                  Delete Recipe
                </h3>
                <div className="mt-2 text-sm text-gray-500">
                  <p>
                    Are you sure you want to delete <strong>{deleteConfirmation.recipe.name}</strong>?
                  </p>
                  {deleteConfirmation.affectedRecipes && deleteConfirmation.affectedRecipes.length > 0 && (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                      <p className="font-medium text-yellow-800 mb-2">
                        ⚠️ This recipe is used as a sub-recipe in the following recipes:
                      </p>
                      <ul className="list-disc list-inside text-yellow-700">
                        {deleteConfirmation.affectedRecipes.map((recipeName, index) => (
                          <li key={index}>{recipeName}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-yellow-700">
                        Deleting this recipe will affect these parent recipes' cost calculations.
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
                  'Delete Recipe'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
