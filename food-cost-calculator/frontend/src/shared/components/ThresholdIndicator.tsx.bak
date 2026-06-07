import type { FC } from 'react';

interface ThresholdIndicatorProps {
  /**
   * The food cost percentage to evaluate.
   */
  foodCostPercentage: number | null | undefined;
  /**
   * The target threshold percentage.
   */
  threshold: number;
  /**
   * Additional CSS classes to apply to the badge.
   */
  className?: string;
  /**
   * Show the percentage value inside the badge. Defaults to false.
   */
  showValue?: boolean;
}

/**
 * ThresholdIndicator - colour-coded badge showing if food cost percentage
 * is exceeding (red) or passing (green) the target threshold.
 * 
 * When foodCostPercentage is null/undefined (e.g., no menu price set),
 * displays a neutral gray badge with "N/A".
 * 
 * @example
 * <ThresholdIndicator foodCostPercentage={35.5} threshold={30} />
 * <ThresholdIndicator foodCostPercentage={25.0} threshold={30} showValue />
 * <ThresholdIndicator foodCostPercentage={null} threshold={30} />
 */
export const ThresholdIndicator: FC<ThresholdIndicatorProps> = ({
  foodCostPercentage,
  threshold,
  className = '',
  showValue = false,
}) => {
  // Handle missing food cost percentage (no menu price set)
  if (foodCostPercentage === null || foodCostPercentage === undefined) {
    return (
      <span
        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500 ${className}`}
        title="Food cost percentage not available"
      >
        N/A
      </span>
    );
  }

  // Determine if exceeding threshold
  const isExceeding = foodCostPercentage > threshold;

  // Color classes based on threshold evaluation
  const colorClasses = isExceeding
    ? 'bg-red-100 text-red-800 border-red-200'
    : 'bg-green-100 text-green-800 border-green-200';

  // Status text
  const statusText = isExceeding ? 'Exceeding' : 'Passing';

  // Display value
  const displayContent = showValue
    ? `${foodCostPercentage.toFixed(1)}%`
    : statusText;

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${colorClasses} ${className}`}
      title={`Food cost ${foodCostPercentage.toFixed(1)}% is ${isExceeding ? 'above' : 'at or below'} threshold of ${threshold}%`}
    >
      {displayContent}
    </span>
  );
};
