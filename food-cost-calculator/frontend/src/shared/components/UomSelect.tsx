import type { FC } from 'react';
import type { UnitOfMeasure } from '../../types/api';

interface UomSelectProps {
  /**
   * The currently selected unit of measure.
   */
  value: UnitOfMeasure;
  /**
   * Callback when the selection changes.
   */
  onChange: (value: UnitOfMeasure) => void;
  /**
   * Optional ID for the select element.
   */
  id?: string;
  /**
   * Optional name for the select element.
   */
  name?: string;
  /**
   * Whether the select is disabled.
   */
  disabled?: boolean;
  /**
   * Additional CSS classes to apply to the select.
   */
  className?: string;
  /**
   * Whether the field is required.
   */
  required?: boolean;
}

/**
 * UOM selection groups and their units.
 * Organized by measurement dimension as per Requirement 6.1.
 */
const UOM_GROUPS = {
  Weight: ['g', 'kg', 'oz', 'lb'] as UnitOfMeasure[],
  Volume: ['ml', 'L', 'tsp', 'tbsp', 'cup'] as UnitOfMeasure[],
  Count: ['each'] as UnitOfMeasure[],
};

/**
 * Human-readable labels for each unit of measure.
 */
const UOM_LABELS: Record<UnitOfMeasure, string> = {
  // Weight
  g: 'grams (g)',
  kg: 'kilograms (kg)',
  oz: 'ounces (oz)',
  lb: 'pounds (lb)',
  // Volume
  ml: 'millilitres (ml)',
  L: 'litres (L)',
  tsp: 'teaspoon (tsp)',
  tbsp: 'tablespoon (tbsp)',
  cup: 'cup',
  // Count
  each: 'each',
};

/**
 * UomSelect - grouped dropdown for selecting units of measure.
 * 
 * Units are organized into logical groups (Weight, Volume, Count)
 * to help users find the appropriate unit quickly.
 * 
 * @example
 * <UomSelect value="g" onChange={(uom) => setUom(uom)} />
 * <UomSelect value="ml" onChange={handleChange} required />
 */
export const UomSelect: FC<UomSelectProps> = ({
  value,
  onChange,
  id,
  name,
  disabled = false,
  className = '',
  required = false,
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as UnitOfMeasure);
  };

  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      required={required}
      className={`px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed ${className}`}
    >
      {Object.entries(UOM_GROUPS).map(([groupName, units]) => (
        <optgroup key={groupName} label={groupName}>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {UOM_LABELS[unit]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};
