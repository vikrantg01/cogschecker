package com.cogschecker.foodcost.shared;

import java.math.BigDecimal;
import java.util.*;

/**
 * Pure validation logic for Recipe domain objects.
 * This class contains stateless validation functions that can be tested independently
 * of the Spring service layer.
 * 
 * Requirements: 2.1, 2.10, 2.11
 */
public class RecipeValidator {
    
    private static final int MIN_PORTION_COUNT = 1;
    private static final int MAX_PORTION_COUNT = 9999;
    private static final int MAX_NAME_LENGTH = 100;
    
    /**
     * Represents a recipe ingredient line for validation purposes.
     */
    public static class RecipeLineInput {
        private final BigDecimal quantityUsed;
        
        public RecipeLineInput(BigDecimal quantityUsed) {
            this.quantityUsed = quantityUsed;
        }
        
        public BigDecimal getQuantityUsed() {
            return quantityUsed;
        }
    }
    
    /**
     * Validation result containing all field-level errors.
     */
    public static class ValidationResult {
        private final Map<String, String> errors;
        
        public ValidationResult() {
            this.errors = new LinkedHashMap<>();
        }
        
        public void addError(String field, String message) {
            errors.put(field, message);
        }
        
        public boolean isValid() {
            return errors.isEmpty();
        }
        
        public Map<String, String> getErrors() {
            return Collections.unmodifiableMap(errors);
        }
        
        public List<String> getFailingFields() {
            return new ArrayList<>(errors.keySet());
        }
    }
    
    /**
     * Validate a recipe with all its fields.
     * 
     * Requirements 2.1, 2.10, 2.11
     * 
     * @param name recipe name
     * @param portionCount number of portions
     * @param ingredientLines list of ingredient lines
     * @return ValidationResult containing all errors found
     */
    public static ValidationResult validateRecipe(
            String name,
            Integer portionCount,
            List<RecipeLineInput> ingredientLines) {
        
        ValidationResult result = new ValidationResult();
        
        validateName(name, result);
        validatePortionCount(portionCount, result);
        validateIngredientLines(ingredientLines, result);
        
        return result;
    }
    
    /**
     * Validate recipe name.
     * Requirement 2.10 - non-empty and non-whitespace, max 100 characters
     */
    private static void validateName(String name, ValidationResult result) {
        if (name == null || name.trim().isEmpty()) {
            result.addError("name", "Recipe name cannot be empty or whitespace");
            return;
        }
        
        if (name.trim().length() > MAX_NAME_LENGTH) {
            result.addError("name", "Recipe name cannot exceed 100 characters");
        }
    }
    
    /**
     * Validate portion count.
     * Requirement 2.10 - between 1 and 9999 inclusive
     */
    private static void validatePortionCount(Integer portionCount, ValidationResult result) {
        if (portionCount == null) {
            result.addError("portionCount", "Portion count is required");
            return;
        }
        
        if (portionCount < MIN_PORTION_COUNT || portionCount > MAX_PORTION_COUNT) {
            result.addError("portionCount", 
                String.format("Portion count must be between %d and %d", MIN_PORTION_COUNT, MAX_PORTION_COUNT));
        }
    }
    
    /**
     * Validate ingredient lines.
     * Requirement 2.10 - all quantities > 0
     */
    private static void validateIngredientLines(List<RecipeLineInput> ingredientLines, ValidationResult result) {
        if (ingredientLines == null) {
            return; // Ingredient lines are optional
        }
        
        // Validate all quantities > 0 - Requirement 2.10
        for (int i = 0; i < ingredientLines.size(); i++) {
            RecipeLineInput line = ingredientLines.get(i);
            if (line.getQuantityUsed() == null || line.getQuantityUsed().compareTo(BigDecimal.ZERO) <= 0) {
                result.addError("ingredientLines[" + i + "].quantityUsed", 
                    "Ingredient line quantity must be greater than 0");
            }
        }
    }
}
