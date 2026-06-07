import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useVenueStore } from '../../store/venueSlice';
import { CostBadge } from '../../shared/components/CostBadge';
import { ThresholdIndicator } from '../../shared/components/ThresholdIndicator';
import type { Recipe } from '../../types/api';

type SortColumn = 'name' | 'foodCostPerPortion' | 'menuSellingPrice' | 'foodCostPercentage';
type SortDirection = 'asc' | 'desc';

interface RecipeCostingRow extends Recipe {
  // All properties from Recipe type
}

export const ReportsPage = () => {
  const currentVenueId = useVenueStore((state) => state.currentVenueId);

  // State for sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // State for filtering
  const [showOnlyExceeding, setShowOnlyExceeding] = useState(false);

  // Default threshold (30%) - in a real app this would come from venue config
  const threshold = 30.0;

  // Fetch costing report data
  const { data: reportData = [], isLoading, error } = useQuery({
    queryKey: ['costing-report', currentVenueId, sortColumn, sortDirection, showOnlyExceeding],
    queryFn: async () => {
      const params: Record<string, string> = {
        sortColumn,
        sortDir: sortDirection,
      };

      if (showOnlyExceeding) {
        params.filter = 'exceedsThreshold';
      }

      const response = await apiClient.get<RecipeCostingRow[]>(
        `/venues/${currentVenueId}/reports/costing`,
        { params }
      );
      return response.data;
    },
    enabled: !!currentVenueId,
  });

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column with ascending as default
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Handle CSV export
  const handleExport = async () => {
    try {
      const params: Record<string, string> = {
        sortColumn,
        sortDir: sortDirection,
      };

      if (showOnlyExceeding) {
        params.filter = 'exceedsThreshold';
      }

      const response = await apiClient.get(
        `/venues/${currentVenueId}/reports/costing/export`,
        { 
          params,
          responseType: 'blob',
        }
      );

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'recipe-costing-report.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export CSV:', error);
    }
  };

  // Render sort icon
  const renderSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }

    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  if (!currentVenueId) {
    return (
      <div className="p-6">
        <div className="alert alert-warning">
          <span>Please select a venue to view reports.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Recipe Costing Report</h1>
        <p className="text-gray-600 text-lg">
          Analyze recipe profitability by comparing food costs against menu prices.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        {/* Filter Toggle */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={showOnlyExceeding}
                onChange={(e) => setShowOnlyExceeding(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-100 peer-checked:bg-blue-600 transition-all duration-200 shadow-inner">
                <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 peer-checked:translate-x-6"></div>
              </div>
            </div>
            <span className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
              Show only exceeding threshold ({threshold}%)
            </span>
          </label>
        </div>

        {/* Export Button */}
        <button
          onClick={handleExport}
          disabled={reportData.length === 0}
          className="btn btn-secondary whitespace-nowrap"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Report Table */}
      <div className="card shadow-md">
        {error && (
          <div className="alert alert-error mb-4">
            <span>Failed to load report data. Please try again.</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="spinner" style={{ width: '2.5rem', height: '2.5rem' }}></span>
            <span className="ml-4 text-gray-600 text-lg font-medium">Loading report...</span>
          </div>
        ) : reportData.length === 0 ? (
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
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {showOnlyExceeding ? 'No recipes exceed the target threshold' : 'No recipes found'}
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              {showOnlyExceeding
                ? 'All recipes are at or below the target food cost percentage. Great job managing costs!'
                : 'Create recipes to see them in the report.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  {/* Recipe Name - Sortable */}
                  <th
                    onClick={() => handleSort('name')}
                    className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 transition-all duration-150 select-none group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="group-hover:text-gray-900">Recipe Name</span>
                      <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                        {renderSortIcon('name')}
                      </div>
                    </div>
                  </th>

                  {/* Food Cost Per Portion - Sortable */}
                  <th
                    onClick={() => handleSort('foodCostPerPortion')}
                    className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 transition-all duration-150 select-none group"
                  >
                    <div className="flex items-center justify-end gap-2">
                      <span className="group-hover:text-gray-900">Food Cost / Portion</span>
                      <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                        {renderSortIcon('foodCostPerPortion')}
                      </div>
                    </div>
                  </th>

                  {/* Menu Price - Sortable */}
                  <th
                    onClick={() => handleSort('menuSellingPrice')}
                    className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 transition-all duration-150 select-none group"
                  >
                    <div className="flex items-center justify-end gap-2">
                      <span className="group-hover:text-gray-900">Menu Price</span>
                      <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                        {renderSortIcon('menuSellingPrice')}
                      </div>
                    </div>
                  </th>

                  {/* Food Cost % - Sortable */}
                  <th
                    onClick={() => handleSort('foodCostPercentage')}
                    className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 transition-all duration-150 select-none group"
                  >
                    <div className="flex items-center justify-end gap-2">
                      <span className="group-hover:text-gray-900">Food Cost %</span>
                      <div className="opacity-70 group-hover:opacity-100 transition-opacity">
                        {renderSortIcon('foodCostPercentage')}
                      </div>
                    </div>
                  </th>

                  {/* Portions - Not sortable */}
                  <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Portions
                  </th>

                  {/* Threshold Indicator */}
                  <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {reportData.map((recipe, index) => (
                  <tr 
                    key={recipe.id} 
                    className="hover:bg-blue-50 transition-all duration-150 group"
                    style={{ 
                      animation: `fadeIn 0.3s ease-out ${index * 0.03}s both` 
                    }}
                  >
                    {/* Recipe Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{recipe.name}</div>
                    </td>

                    {/* Food Cost Per Portion */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <CostBadge value={recipe.foodCostPerPortion} />
                    </td>

                    {/* Menu Price */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <CostBadge value={recipe.menuSellingPrice || null} />
                    </td>

                    {/* Food Cost Percentage */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {recipe.foodCostPercentage !== null && recipe.foodCostPercentage !== undefined ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-md text-sm font-bold font-mono bg-gray-100 text-gray-900 group-hover:bg-blue-100 group-hover:text-blue-900 transition-colors">
                          {recipe.foodCostPercentage.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-md text-sm font-mono bg-gray-50 text-gray-400">N/A</span>
                      )}
                    </td>

                    {/* Portions */}
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className="inline-flex items-center px-3 py-1 rounded-md text-sm font-semibold bg-gray-100 text-gray-700 group-hover:bg-blue-100 group-hover:text-blue-800 transition-colors">
                        {recipe.portionCount}
                      </span>
                    </td>

                    {/* Status Indicator */}
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <ThresholdIndicator
                        foodCostPercentage={recipe.foodCostPercentage}
                        threshold={threshold}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {!isLoading && reportData.length > 0 && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="card shadow-md hover:shadow-lg transition-shadow duration-200 bg-gradient-to-br from-white to-blue-50 border-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">Total Recipes</div>
                <div className="text-3xl font-extrabold text-gray-900">{reportData.length}</div>
              </div>
              <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>
          <div className="card shadow-md hover:shadow-lg transition-shadow duration-200 bg-gradient-to-br from-white to-red-50 border-red-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">Exceeding Threshold</div>
                <div className="text-3xl font-extrabold text-red-600">
                  {reportData.filter((r) => r.foodCostPercentage && r.foodCostPercentage > threshold).length}
                </div>
              </div>
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>
          <div className="card shadow-md hover:shadow-lg transition-shadow duration-200 bg-gradient-to-br from-white to-green-50 border-green-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">Within Target</div>
                <div className="text-3xl font-extrabold text-green-600">
                  {reportData.filter((r) => r.foodCostPercentage && r.foodCostPercentage <= threshold).length}
                </div>
              </div>
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
