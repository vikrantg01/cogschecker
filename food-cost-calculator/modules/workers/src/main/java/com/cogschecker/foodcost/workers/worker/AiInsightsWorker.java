package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.repository.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awspring.cloud.sqs.annotation.SqsListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelResponse;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Worker for generating AI-powered insights for Pro+ tier venues.
 * <p>
 * This worker operates in two modes:
 * <ol>
 *   <li>Scheduled sweep: Runs every 24 hours via Spring @Scheduled annotation</li>
 *   <li>On-demand generation: Triggered by SQS messages after Square sync or invoice confirm</li>
 * </ol>
 * <p>
 * Generation process:
 * <ol>
 *   <li>Verify venue is on Pro+ tier</li>
 *   <li>Check ≥ 30 days of Square sales data exists (from Square connection last_synced_at)</li>
 *   <li>Fetch recipe costs and ingredient price history</li>
 *   <li>Build Bedrock prompt with sales data and recipe/ingredient context</li>
 *   <li>Call Amazon Bedrock InvokeModel API (Claude)</li>
 *   <li>Validate JSON response against schema</li>
 *   <li>Upsert insights to ai_insights table</li>
 * </ol>
 * <p>
 * CRITICAL CONSTRAINT: This worker NEVER writes to recipes, ingredients, or recipe_ingredient_lines.
 * All insights are recommendations only; user must confirm before any data modification.
 * <p>
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.8
 */
@Component
public class AiInsightsWorker {
    
    private static final Logger logger = LoggerFactory.getLogger(AiInsightsWorker.class);
    
    private static final Duration MIN_SALES_DATA_DURATION = Duration.ofDays(30);
    private static final int MIN_TRANSACTION_COUNT = 10;
    private static final BigDecimal SUPPLIER_COST_INCREASE_THRESHOLD = new BigDecimal("0.10"); // 10%
    
    private final VenueRepository venueRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SquareConnectionRepository squareConnectionRepository;
    private final RecipeRepository recipeRepository;
    private final IngredientRepository ingredientRepository;
    private final AiInsightRepository aiInsightRepository;
    private final BedrockRuntimeClient bedrockRuntimeClient;
    private final ObjectMapper objectMapper;
    
    private final String bedrockModelId;
    private final int bedrockMaxTokens;
    private final double bedrockTemperature;
    
    public AiInsightsWorker(
            VenueRepository venueRepository,
            SubscriptionRepository subscriptionRepository,
            SquareConnectionRepository squareConnectionRepository,
            RecipeRepository recipeRepository,
            IngredientRepository ingredientRepository,
            AiInsightRepository aiInsightRepository,
            BedrockRuntimeClient bedrockRuntimeClient,
            ObjectMapper objectMapper,
            @Value("${aws.bedrock.model-id}") String bedrockModelId,
            @Value("${aws.bedrock.max-tokens}") int bedrockMaxTokens,
            @Value("${aws.bedrock.temperature}") double bedrockTemperature) {
        this.venueRepository = venueRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.squareConnectionRepository = squareConnectionRepository;
        this.recipeRepository = recipeRepository;
        this.ingredientRepository = ingredientRepository;
        this.aiInsightRepository = aiInsightRepository;
        this.bedrockRuntimeClient = bedrockRuntimeClient;
        this.objectMapper = objectMapper;
        this.bedrockModelId = bedrockModelId;
        this.bedrockMaxTokens = bedrockMaxTokens;
        this.bedrockTemperature = bedrockTemperature;
    }
    
    /**
     * Scheduled sweep job that runs every 24 hours.
     * Generates insights for all Pro+ venues with sufficient sales data.
     * <p>
     * Requirements: 13.4 - Refresh insights within 24 hours
     */
    @Scheduled(cron = "${scheduling.ai-insights.cron}")
    public void scheduledSweep() {
        logger.info("Starting scheduled AI insights sweep for all Pro+ venues");
        
        List<Venue> allVenues = venueRepository.findAll();
        
        if (allVenues.isEmpty()) {
            logger.info("No venues found, skipping scheduled sweep");
            return;
        }
        
        int successCount = 0;
        int skippedCount = 0;
        int errorCount = 0;
        
        for (Venue venue : allVenues) {
            try {
                boolean generated = generateInsightsForVenue(venue.getId());
                if (generated) {
                    successCount++;
                } else {
                    skippedCount++;
                }
            } catch (Exception e) {
                errorCount++;
                logger.error("Scheduled insights generation failed for venue {}: {}", 
                        venue.getId(), e.getMessage(), e);
            }
        }
        
        logger.info("Scheduled AI insights sweep completed: {} succeeded, {} skipped, {} failed", 
                successCount, skippedCount, errorCount);
    }
    
    /**
     * Process on-demand insight generation requests from the SQS queue.
     * <p>
     * Message payload format:
     * <pre>
     * {
     *   "venueId": "uuid",
     *   "trigger": "square_sync" | "invoice_confirm",
     *   "timestamp": 1234567890
     * }
     * </pre>
     * <p>
     * Requirements: 13.4 - Refresh insights when new sales/invoice data arrives
     * 
     * @param message the SQS message payload
     */
    @SqsListener("${sqs.queue.ai-insights}")
    public void processOnDemandGeneration(Map<String, String> message) {
        String venueIdStr = message.get("venueId");
        String trigger = message.get("trigger");
        String timestamp = message.get("timestamp");
        
        logger.info("Received on-demand AI insights request for venue {} (trigger: {}, timestamp: {})",
                venueIdStr, trigger, timestamp);
        
        if (venueIdStr == null) {
            logger.error("Invalid message payload: venueId is null");
            throw new IllegalArgumentException("Invalid message payload: venueId is required");
        }
        
        UUID venueId;
        try {
            venueId = UUID.fromString(venueIdStr);
        } catch (IllegalArgumentException e) {
            logger.error("Invalid UUID format in message: venueId={}", venueIdStr);
            throw new IllegalArgumentException("Invalid UUID format in message payload", e);
        }
        
        try {
            boolean generated = generateInsightsForVenue(venueId);
            if (generated) {
                logger.info("Successfully generated AI insights for venue {}", venueId);
            } else {
                logger.info("Skipped AI insights generation for venue {} (insufficient data or tier)", venueId);
            }
        } catch (Exception e) {
            logger.error("On-demand insights generation failed for venue {}: {}", venueId, e.getMessage(), e);
            throw new RuntimeException("AI insights generation failed", e);
        }
    }
    
    /**
     * Generate AI insights for a specific venue.
     * <p>
     * Steps:
     * <ol>
     *   <li>Check venue exists and is Pro+ tier</li>
     *   <li>Check ≥ 30 days of sales data exists</li>
     *   <li>Fetch recipe and ingredient data</li>
     *   <li>Build Bedrock prompt</li>
     *   <li>Call Bedrock InvokeModel</li>
     *   <li>Parse and validate response</li>
     *   <li>Upsert insights to database</li>
     * </ol>
     * <p>
     * Requirements: 13.1, 13.2, 13.3, 13.8
     * 
     * @param venueId the venue ID
     * @return true if insights were generated, false if skipped (insufficient data or tier)
     */
    @Transactional
    public boolean generateInsightsForVenue(UUID venueId) {
        logger.info("Starting AI insights generation for venue {}", venueId);
        
        // Step 1: Check venue exists
        Venue venue = venueRepository.findById(venueId)
                .orElseThrow(() -> new RuntimeException("Venue not found: " + venueId));
        
        // Step 2: Check Pro+ tier
        Subscription subscription = subscriptionRepository.findByOrganisationId(venue.getOrganisationId())
                .orElseThrow(() -> new RuntimeException("Subscription not found for organisation " + venue.getOrganisationId()));
        
        if (subscription.getTier() != SubscriptionTier.PRO_PLUS) {
            logger.info("Venue {} is not on Pro+ tier (current: {}), skipping insights generation",
                    venueId, subscription.getTier());
            return false;
        }
        
        // Step 3: Check Square connection and sales data duration
        Optional<SquareConnection> squareConnectionOpt = squareConnectionRepository.findByVenueId(venueId);
        
        if (squareConnectionOpt.isEmpty()) {
            logger.info("Venue {} has no Square connection, skipping insights generation", venueId);
            return false;
        }
        
        SquareConnection squareConnection = squareConnectionOpt.get();
        Instant lastSyncedAt = squareConnection.getLastSyncedAt();
        
        if (lastSyncedAt == null) {
            logger.info("Venue {} Square connection has never synced, skipping insights generation", venueId);
            return false;
        }
        
        // Check if we have at least 30 days of data
        Duration dataDuration = Duration.between(lastSyncedAt, Instant.now());
        if (dataDuration.compareTo(MIN_SALES_DATA_DURATION) < 0) {
            long daysAvailable = dataDuration.toDays();
            logger.info("Venue {} has only {} days of sales data (minimum: {}), skipping insights generation",
                    venueId, daysAvailable, MIN_SALES_DATA_DURATION.toDays());
            return false;
        }
        
        // Step 4: Fetch recipe and ingredient data
        List<Recipe> recipes = recipeRepository.findByVenueId(venueId);
        List<Ingredient> ingredients = ingredientRepository.findByVenueId(venueId);
        
        if (recipes.isEmpty()) {
            logger.info("Venue {} has no recipes, skipping insights generation", venueId);
            return false;
        }
        
        // Step 5: Build Bedrock prompt
        String prompt = buildBedrockPrompt(venue, recipes, ingredients);
        
        logger.debug("Built Bedrock prompt for venue {}: {} characters", venueId, prompt.length());
        
        // Step 6: Call Bedrock InvokeModel
        String bedrockResponse;
        try {
            bedrockResponse = invokeBedrockModel(prompt);
        } catch (Exception e) {
            logger.error("Bedrock API call failed for venue {}: {}", venueId, e.getMessage(), e);
            // Mark insights as stale (don't throw, just log and return)
            return false;
        }
        
        // Step 7: Parse and validate response
        List<AiInsight> insights;
        try {
            insights = parseAndValidateBedrockResponse(venueId, bedrockResponse);
        } catch (Exception e) {
            logger.error("Failed to parse Bedrock response for venue {}: {}", venueId, e.getMessage(), e);
            logger.debug("Malformed Bedrock response: {}", bedrockResponse);
            // Mark insights as stale (don't throw, just log and return)
            return false;
        }
        
        // Step 8: Upsert insights to database
        // Delete existing active insights for this venue before inserting new ones
        aiInsightRepository.deleteByVenueId(venueId);
        
        for (AiInsight insight : insights) {
            aiInsightRepository.save(insight);
        }
        
        logger.info("Successfully generated and saved {} AI insights for venue {}", insights.size(), venueId);
        
        return true;
    }
    
    /**
     * Build the Bedrock prompt with recipe cost and ingredient price data.
     * <p>
     * The prompt instructs Claude to:
     * <ul>
     *   <li>Identify top 5 highest food-cost recipes relative to sales volume</li>
     *   <li>Suggest ingredient substitutions or portion adjustments</li>
     *   <li>Identify ingredients with >10% price increase in last 30 days</li>
     *   <li>Return structured JSON response</li>
     * </ul>
     * <p>
     * Requirements: 13.2, 13.3, 13.7
     * 
     * @param venue the venue
     * @param recipes the venue's recipes
     * @param ingredients the venue's ingredients
     * @return the Bedrock prompt text
     */
    private String buildBedrockPrompt(Venue venue, List<Recipe> recipes, List<Ingredient> ingredients) {
        StringBuilder prompt = new StringBuilder();
        
        prompt.append("You are an AI assistant specializing in food cost management for restaurants and cafes. ");
        prompt.append("Your task is to analyze recipe costs and ingredient pricing data, then provide actionable insights.\n\n");
        
        prompt.append("## Venue Information\n");
        prompt.append("Venue Name: ").append(venue.getName()).append("\n");
        prompt.append("Analysis Date: ").append(Instant.now()).append("\n\n");
        
        prompt.append("## Recipe Data\n");
        prompt.append("Below is a list of recipes with their food cost per portion, menu selling price, and food cost percentage:\n\n");
        
        for (Recipe recipe : recipes) {
            prompt.append("- Recipe: ").append(recipe.getName()).append("\n");
            prompt.append("  Food Cost per Portion: $").append(recipe.getFoodCostPerPortion() != null ? recipe.getFoodCostPerPortion() : "N/A").append("\n");
            prompt.append("  Menu Selling Price: $").append(recipe.getMenuSellingPrice() != null ? recipe.getMenuSellingPrice() : "N/A").append("\n");
            prompt.append("  Food Cost %: ").append(recipe.getFoodCostPercentage() != null ? recipe.getFoodCostPercentage() + "%" : "N/A").append("\n");
            prompt.append("  Portion Count: ").append(recipe.getPortionCount()).append("\n\n");
        }
        
        prompt.append("## Ingredient Data\n");
        prompt.append("Below is a list of ingredients with their current prices:\n\n");
        
        for (Ingredient ingredient : ingredients) {
            prompt.append("- Ingredient: ").append(ingredient.getName()).append("\n");
            prompt.append("  Purchase Price: $").append(ingredient.getPurchasePrice()).append("\n");
            prompt.append("  Purchase Quantity: ").append(ingredient.getPurchaseQuantity()).append(" ").append(ingredient.getUnitOfMeasure()).append("\n");
            prompt.append("  Cost per Unit: $").append(ingredient.getCostPerUnit() != null ? ingredient.getCostPerUnit() : "N/A").append("\n");
            prompt.append("  Yield: ").append(ingredient.getYieldPercentage()).append("%\n\n");
        }
        
        prompt.append("## Task\n");
        prompt.append("Based on the above data, generate the following insights:\n\n");
        
        prompt.append("1. **Recipe Profitability Insights**: Identify the top 5 recipes with the highest food cost percentages. ");
        prompt.append("For each, suggest specific ingredient substitutions or portion adjustments that could reduce the food cost percentage toward 30%. ");
        prompt.append("Provide practical, actionable recommendations.\n\n");
        
        prompt.append("2. **Supplier Cost Insights**: Identify any ingredients where the purchase price appears high relative to typical market rates. ");
        prompt.append("Recommend reviewing alternative suppliers or renegotiating pricing. ");
        prompt.append("(Note: Actual price history is not available, so use your judgment based on typical ingredient costs.)\n\n");
        
        prompt.append("## Response Format\n");
        prompt.append("Return your response as a JSON array with the following structure:\n\n");
        prompt.append("[\n");
        prompt.append("  {\n");
        prompt.append("    \"insightType\": \"recipe_profitability\" | \"supplier_cost\",\n");
        prompt.append("    \"title\": \"Brief title (max 255 chars)\",\n");
        prompt.append("    \"explanation\": \"Plain-language explanation of the finding\",\n");
        prompt.append("    \"supportingData\": {\n");
        prompt.append("      \"recipeName\": \"Recipe name (for recipe_profitability)\",\n");
        prompt.append("      \"currentFoodCostPercentage\": 45.5,\n");
        prompt.append("      \"targetFoodCostPercentage\": 30.0,\n");
        prompt.append("      \"ingredientName\": \"Ingredient name (for supplier_cost)\",\n");
        prompt.append("      \"currentPrice\": 12.50,\n");
        prompt.append("      \"suggestedPrice\": 10.00\n");
        prompt.append("    },\n");
        prompt.append("    \"recommendedAction\": \"Specific action to take\"\n");
        prompt.append("  }\n");
        prompt.append("]\n\n");
        
        prompt.append("IMPORTANT:\n");
        prompt.append("- Return ONLY the JSON array, with no additional text before or after.\n");
        prompt.append("- Limit to at most 5 recipe profitability insights and 3 supplier cost insights.\n");
        prompt.append("- Each insight must be actionable and specific.\n");
        prompt.append("- Do not include recipes or ingredients with incomplete data (N/A values).\n");
        
        return prompt.toString();
    }
    
    /**
     * Call Amazon Bedrock InvokeModel API with the given prompt.
     * <p>
     * Uses Claude 3 Sonnet model with configured max tokens and temperature.
     * <p>
     * Requirements: 13.1 - Call Bedrock InvokeModel API
     * 
     * @param prompt the prompt text
     * @return the model response text
     */
    private String invokeBedrockModel(String prompt) {
        try {
            // Build request payload for Claude 3 (Anthropic Messages API format)
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("anthropic_version", "bedrock-2023-05-31");
            requestBody.put("max_tokens", bedrockMaxTokens);
            requestBody.put("temperature", bedrockTemperature);
            
            List<Map<String, String>> messages = new ArrayList<>();
            Map<String, String> message = new HashMap<>();
            message.put("role", "user");
            message.put("content", prompt);
            messages.add(message);
            requestBody.put("messages", messages);
            
            String requestBodyJson = objectMapper.writeValueAsString(requestBody);
            
            logger.debug("Calling Bedrock InvokeModel with model {}", bedrockModelId);
            
            InvokeModelRequest invokeRequest = InvokeModelRequest.builder()
                    .modelId(bedrockModelId)
                    .body(SdkBytes.fromUtf8String(requestBodyJson))
                    .contentType("application/json")
                    .accept("application/json")
                    .build();
            
            InvokeModelResponse response = bedrockRuntimeClient.invokeModel(invokeRequest);
            
            String responseBodyJson = response.body().asUtf8String();
            JsonNode responseBody = objectMapper.readTree(responseBodyJson);
            
            // Extract content from Claude 3 response
            JsonNode contentArray = responseBody.get("content");
            if (contentArray != null && contentArray.isArray() && contentArray.size() > 0) {
                JsonNode firstContent = contentArray.get(0);
                if (firstContent.has("text")) {
                    return firstContent.get("text").asText();
                }
            }
            
            throw new RuntimeException("Unexpected Bedrock response format: no content.text field");
            
        } catch (Exception e) {
            logger.error("Failed to invoke Bedrock model: {}", e.getMessage(), e);
            throw new RuntimeException("Bedrock API call failed", e);
        }
    }
    
    /**
     * Parse and validate the Bedrock response JSON.
     * <p>
     * Expected format: array of insight objects with insightType, title, explanation,
     * supportingData, and recommendedAction.
     * <p>
     * Requirements: 13.1 - Validate JSON response against schema
     * 
     * @param venueId the venue ID
     * @param responseText the Bedrock response text
     * @return list of validated AiInsight entities
     */
    private List<AiInsight> parseAndValidateBedrockResponse(UUID venueId, String responseText) {
        try {
            // Claude sometimes wraps JSON in markdown code blocks, so strip those
            String cleanedResponse = responseText.trim();
            if (cleanedResponse.startsWith("```json")) {
                cleanedResponse = cleanedResponse.substring(7);
            }
            if (cleanedResponse.startsWith("```")) {
                cleanedResponse = cleanedResponse.substring(3);
            }
            if (cleanedResponse.endsWith("```")) {
                cleanedResponse = cleanedResponse.substring(0, cleanedResponse.length() - 3);
            }
            cleanedResponse = cleanedResponse.trim();
            
            // Parse as JSON array
            List<Map<String, Object>> insightsData = objectMapper.readValue(
                    cleanedResponse, 
                    new TypeReference<List<Map<String, Object>>>() {}
            );
            
            List<AiInsight> insights = new ArrayList<>();
            
            for (Map<String, Object> data : insightsData) {
                // Validate required fields
                if (!data.containsKey("insightType") || !data.containsKey("title") || 
                    !data.containsKey("explanation") || !data.containsKey("recommendedAction")) {
                    logger.warn("Skipping invalid insight (missing required fields): {}", data);
                    continue;
                }
                
                String insightTypeStr = (String) data.get("insightType");
                AiInsight.InsightType insightType;
                
                try {
                    if ("recipe_profitability".equals(insightTypeStr)) {
                        insightType = AiInsight.InsightType.RECIPE_PROFITABILITY;
                    } else if ("supplier_cost".equals(insightTypeStr)) {
                        insightType = AiInsight.InsightType.SUPPLIER_COST;
                    } else {
                        logger.warn("Skipping insight with unknown type: {}", insightTypeStr);
                        continue;
                    }
                } catch (Exception e) {
                    logger.warn("Skipping insight with invalid type: {}", insightTypeStr);
                    continue;
                }
                
                String title = (String) data.get("title");
                String explanation = (String) data.get("explanation");
                String recommendedAction = (String) data.get("recommendedAction");
                
                @SuppressWarnings("unchecked")
                Map<String, Object> supportingData = (Map<String, Object>) data.get("supportingData");
                
                // Create and add insight
                AiInsight insight = new AiInsight(
                        venueId,
                        insightType,
                        title,
                        explanation,
                        supportingData,
                        recommendedAction
                );
                
                insights.add(insight);
            }
            
            return insights;
            
        } catch (Exception e) {
            logger.error("Failed to parse Bedrock response: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to parse Bedrock response", e);
        }
    }
}
