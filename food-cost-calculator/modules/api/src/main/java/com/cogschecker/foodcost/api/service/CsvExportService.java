package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.dto.RecipeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Service for exporting recipe costing reports to CSV format.
 * Requirements: 5.6, 5.7
 */
@Service
public class CsvExportService {
    
    private static final Logger logger = LoggerFactory.getLogger(CsvExportService.class);
    
    /**
     * Generate CSV export from a list of recipes.
     * 
     * Requirements:
     * - 5.6: Columns: Recipe Name, Food Cost Per Portion (2 d.p.), Menu Price (2 d.p.), 
     *        Food Cost Percentage (1 d.p.), Portions Per Batch
     * - 5.7: When report is filtered, export only filtered rows (caller responsibility to pass filtered list)
     * 
     * @param recipes the list of recipes to export (pre-filtered and sorted by caller)
     * @return CSV content as a string
     */
    public String export(List<RecipeResponse> recipes) {
        logger.info("Generating CSV export for {} recipes", recipes.size());
        
        StringBuilder csv = new StringBuilder();
        
        // Header row - Requirement 5.6
        csv.append("Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n");
        
        // Data rows
        for (RecipeResponse recipe : recipes) {
            csv.append(escapeCsvField(recipe.getName()));
            csv.append(",");
            
            // Food Cost Per Portion - 2 decimal places
            csv.append(formatDecimal(recipe.getFoodCostPerPortion(), 2));
            csv.append(",");
            
            // Menu Price - 2 decimal places
            csv.append(formatDecimal(recipe.getMenuSellingPrice(), 2));
            csv.append(",");
            
            // Food Cost Percentage - 1 decimal place
            // Display "N/A" if menu price is null or zero (as per requirements 4.3)
            if (recipe.getFoodCostPercentage() == null) {
                csv.append("N/A");
            } else {
                csv.append(formatDecimal(recipe.getFoodCostPercentage(), 1));
            }
            csv.append(",");
            
            // Portions Per Batch (integer, no decimal places needed)
            csv.append(recipe.getPortionCount() != null ? recipe.getPortionCount().toString() : "");
            csv.append("\n");
        }
        
        logger.info("CSV export generated successfully");
        return csv.toString();
    }
    
    /**
     * Format a BigDecimal to the specified number of decimal places.
     * Returns empty string if value is null.
     * Requirement 5.6: Apply correct rounding (2 d.p. for costs/prices, 1 d.p. for percentage)
     */
    private String formatDecimal(BigDecimal value, int decimalPlaces) {
        if (value == null) {
            return "";
        }
        return value.setScale(decimalPlaces, RoundingMode.HALF_UP).toPlainString();
    }
    
    /**
     * Escape a CSV field value.
     * Wraps in quotes if the field contains comma, newline, or quote characters.
     * Doubles any internal quotes as per CSV RFC 4180.
     */
    private String escapeCsvField(String field) {
        if (field == null) {
            return "";
        }
        
        // Check if field needs escaping
        if (field.contains(",") || field.contains("\"") || field.contains("\n") || field.contains("\r")) {
            // Replace internal quotes with double quotes
            String escaped = field.replace("\"", "\"\"");
            // Wrap in quotes
            return "\"" + escaped + "\"";
        }
        
        return field;
    }
}
