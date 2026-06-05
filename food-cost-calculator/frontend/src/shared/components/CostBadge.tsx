import type { FC } from 'react';

interface CostBadgeProps {
  /**
   * The cost value to display. If null/undefined, shows missing-price placeholder.
   */
  value: number | null | undefined;
  /**
   * Currency symbol to prefix the cost. Defaults to '$'.
   */
  currency?: string;
  /**
   * Number of decimal places to display. Defaults to 2.
   */
  decimals?: number;
  /**
   * Additional CSS classes to apply to the badge.
   */
  className?: string;
}

/**
 * CostBadge - displays a cost value with missing-price placeholder support.
 * 
 * When value is null/undefined, displays a "—" placeholder to indicate
 * missing price data instead of showing $0.00.
 * 
 * @example
 * <CostBadge value={12.50} />
 * <CostBadge value={null} /> // Shows "—"
 * <CostBadge value={45.678} decimals={3} />
 */
export const CostBadge: FC<CostBadgeProps> = ({
  value,
  currency = '$',
  decimals = 2,
  className = '',
}) => {
  // Handle missing price
  if (value === null || value === undefined) {
    return (
      <span
        className={`inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-400 text-sm font-mono ${className}`}
        title="Price not set"
      >
        —
      </span>
    );
  }

  // Format the cost value
  const formattedValue = value.toFixed(decimals);

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded bg-gray-50 text-gray-900 text-sm font-mono ${className}`}
    >
      {currency}{formattedValue}
    </span>
  );
};
