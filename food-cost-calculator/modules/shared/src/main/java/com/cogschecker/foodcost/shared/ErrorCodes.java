package com.cogschecker.foodcost.shared;

/**
 * Centralized error code constants for the food cost calculator system.
 * Error codes are grouped by domain.
 */
public final class ErrorCodes {
    
    private ErrorCodes() {
        // Utility class, no instantiation
    }
    
    // Ingredient errors (1xxx)
    public static final String INGREDIENT_DUPLICATE_NAME = "INGREDIENT_1001";
    public static final String INGREDIENT_NOT_FOUND = "INGREDIENT_1002";
    public static final String INGREDIENT_INVALID_PRICE = "INGREDIENT_1003";
    public static final String INGREDIENT_INVALID_QUANTITY = "INGREDIENT_1004";
    public static final String INGREDIENT_INVALID_YIELD = "INGREDIENT_1005";
    public static final String INGREDIENT_IN_USE = "INGREDIENT_1006";
    public static final String INGREDIENT_MISSING_PRICE = "INGREDIENT_1007";
    
    // Recipe errors (2xxx)
    public static final String RECIPE_DUPLICATE_NAME = "RECIPE_2001";
    public static final String RECIPE_NOT_FOUND = "RECIPE_2002";
    public static final String RECIPE_INVALID_PORTION_COUNT = "RECIPE_2003";
    public static final String RECIPE_INVALID_NAME = "RECIPE_2004";
    public static final String RECIPE_CIRCULAR_REFERENCE = "RECIPE_2005";
    public static final String RECIPE_IN_USE_AS_SUBRECIPE = "RECIPE_2006";
    public static final String RECIPE_TOO_MANY_LINES = "RECIPE_2007";
    public static final String RECIPE_TIER_LIMIT_EXCEEDED = "RECIPE_2008";
    
    // Unit of measure errors (3xxx)
    public static final String UOM_INCOMPATIBLE_DIMENSIONS = "UOM_3001";
    public static final String UOM_UNKNOWN_UNIT = "UOM_3002";
    public static final String UOM_INVALID_QUANTITY = "UOM_3003";
    
    // Venue errors (4xxx)
    public static final String VENUE_NOT_FOUND = "VENUE_4001";
    public static final String VENUE_DUPLICATE_NAME = "VENUE_4002";
    public static final String VENUE_TIER_LIMIT_EXCEEDED = "VENUE_4003";
    public static final String VENUE_HAS_DATA = "VENUE_4004";
    
    // Organisation errors (4xxx - continuing venue series)
    public static final String ORGANISATION_NOT_FOUND = "ORGANISATION_4005";
    
    // Authentication and authorization errors (5xxx)
    public static final String AUTH_INVALID_CREDENTIALS = "AUTH_5001";
    public static final String AUTH_TOKEN_EXPIRED = "AUTH_5002";
    public static final String AUTH_INSUFFICIENT_PERMISSIONS = "AUTH_5003";
    public static final String AUTH_USER_NOT_FOUND = "AUTH_5004";
    public static final String AUTH_INVALID_PASSWORD = "AUTH_5005";
    public static final String AUTH_EMAIL_ALREADY_EXISTS = "AUTH_5006";
    
    // Subscription errors (6xxx)
    public static final String SUBSCRIPTION_FEATURE_NOT_AVAILABLE = "SUBSCRIPTION_6001";
    public static final String SUBSCRIPTION_PAYMENT_FAILED = "SUBSCRIPTION_6002";
    public static final String SUBSCRIPTION_DOWNGRADE_CONFLICT = "SUBSCRIPTION_6003";
    public static final String SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_6004";
    
    // Data import/export errors (7xxx)
    public static final String DATA_IMPORT_INVALID_FORMAT = "DATA_7001";
    public static final String DATA_IMPORT_VALIDATION_FAILED = "DATA_7002";
    public static final String DATA_EXPORT_FAILED = "DATA_7003";
    public static final String DATA_CORRUPTED = "DATA_7004";
    
    // Integration errors (8xxx)
    public static final String SQUARE_CONNECTION_FAILED = "SQUARE_8001";
    public static final String SQUARE_SYNC_FAILED = "SQUARE_8002";
    public static final String SQUARE_AUTH_FAILED = "SQUARE_8003";
    public static final String INVOICE_UPLOAD_FAILED = "INVOICE_8004";
    public static final String INVOICE_OCR_FAILED = "INVOICE_8005";
    public static final String AI_INSIGHTS_FAILED = "AI_8006";
    public static final String STRIPE_WEBHOOK_INVALID_SIGNATURE = "STRIPE_8007";
    public static final String STRIPE_WEBHOOK_PROCESSING_FAILED = "STRIPE_8008";
    
    // Validation errors (9xxx)
    public static final String VALIDATION_REQUIRED_FIELD = "VALIDATION_9001";
    public static final String VALIDATION_INVALID_FORMAT = "VALIDATION_9002";
    public static final String VALIDATION_OUT_OF_RANGE = "VALIDATION_9003";
    public static final String VALIDATION_CONSTRAINT_VIOLATION = "VALIDATION_9004";
}
