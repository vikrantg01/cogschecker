import type { FC } from 'react';

interface DowngradeConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  excessVenueCount: number;
  venuesWithExcessRecipes: Record<string, number>;
}

/**
 * DowngradeConflictModal - displays conflicts preventing a downgrade.
 * Requirements: 11.6
 *
 * Shows when a downgrade would violate tier limits (e.g., too many venues or recipes).
 * Requires the admin to resolve conflicts before the downgrade can proceed.
 */
export const DowngradeConflictModal: FC<DowngradeConflictModalProps> = ({
  isOpen,
  onClose,
  excessVenueCount,
  venuesWithExcessRecipes,
}) => {
  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-red-500 px-6 py-4">
          <h2 id="conflict-modal-title" className="text-xl font-semibold text-white">
            Downgrade Conflicts Detected
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-gray-700 mb-4">
            Your organisation exceeds the limits of the target tier. Please resolve the
            following conflicts before downgrading:
          </p>

          {excessVenueCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold text-red-900 mb-2">Excess Venues</h3>
              <p className="text-sm text-red-700">
                You have <span className="font-semibold">{excessVenueCount}</span> too many
                venue(s). Please delete venues to meet the tier limit.
              </p>
            </div>
          )}

          {Object.keys(venuesWithExcessRecipes).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-red-900 mb-2">Excess Recipes</h3>
              <p className="text-sm text-red-700 mb-2">
                The following venues have too many recipes:
              </p>
              <ul className="space-y-1">
                {Object.entries(venuesWithExcessRecipes).map(([venueId, excessCount]) => (
                  <li key={venueId} className="text-sm text-red-700">
                    <span className="font-semibold">Venue {venueId.slice(0, 8)}...</span>:{' '}
                    {excessCount} excess recipe(s)
                  </li>
                ))}
              </ul>
              <p className="text-sm text-red-700 mt-2">
                Please delete recipes to meet the 25-recipe-per-venue limit.
              </p>
            </div>
          )}

          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              Once you've resolved these conflicts, you can retry the downgrade.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
