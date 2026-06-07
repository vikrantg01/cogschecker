package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.exception.*;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.InvoiceLineItemRepository;
import com.cogschecker.foodcost.api.repository.InvoiceRepository;
import com.cogschecker.foodcost.shared.CostCalculator;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.cogschecker.foodcost.shared.UomEnum;
import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.*;

/**
 * Service for invoice upload and management.
 * Requirements: 12.6 (Invoice Upload), 12.7 (OCR Processing), 12.10 (Invoice History)
 */
@Service
public class InvoiceService {
    
    private static final Logger logger = LoggerFactory.getLogger(InvoiceService.class);
    
    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    private static final Set<String> ALLOWED_FILE_TYPES = Set.of(
            "application/pdf",
            "image/jpeg",
            "image/png"
    );
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "pdf", "jpg", "jpeg", "png"
    );
    
    private final InvoiceRepository invoiceRepository;
    private final InvoiceLineItemRepository invoiceLineItemRepository;
    private final IngredientRepository ingredientRepository;
    private final S3Client s3Client;
    private final SqsTemplate sqsTemplate;
    private final CostPropagationService costPropagationService;
    
    @Value("${s3.bucket.invoices}")
    private String invoicesBucket;
    
    @Value("${sqs.queue.ocr-processing}")
    private String ocrProcessingQueue;
    
    public InvoiceService(
            InvoiceRepository invoiceRepository,
            InvoiceLineItemRepository invoiceLineItemRepository,
            IngredientRepository ingredientRepository,
            S3Client s3Client,
            SqsTemplate sqsTemplate,
            CostPropagationService costPropagationService) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceLineItemRepository = invoiceLineItemRepository;
        this.ingredientRepository = ingredientRepository;
        this.s3Client = s3Client;
        this.sqsTemplate = sqsTemplate;
        this.costPropagationService = costPropagationService;
    }
    
    /**
     * Upload an invoice file, store it in S3, create database record, and enqueue OCR processing.
     * Requirements: 12.6, 12.7
     * 
     * @param venueId the venue ID
     * @param file the uploaded file
     * @param uploadedBy the user ID who uploaded the file
     * @return the created Invoice entity
     * @throws InvalidFileTypeException if file type is not allowed
     * @throws FileSizeExceededException if file size exceeds limit
     * @throws IOException if file reading fails
     */
    @Transactional
    public Invoice uploadInvoice(UUID venueId, MultipartFile file, UUID uploadedBy) 
            throws InvalidFileTypeException, FileSizeExceededException, IOException {
        
        logger.info("Uploading invoice for venue {}: filename={}, size={}, contentType={}", 
                   venueId, file.getOriginalFilename(), file.getSize(), file.getContentType());
        
        // Validate file size (≤ 10 MB)
        if (file.getSize() > MAX_FILE_SIZE) {
            logger.warn("File size exceeds limit: {} bytes (max: {})", file.getSize(), MAX_FILE_SIZE);
            throw new FileSizeExceededException("File size exceeds the maximum allowed size of 10 MB");
        }
        
        // Validate file type
        String contentType = file.getContentType();
        String originalFilename = file.getOriginalFilename();
        
        if (!isValidFileType(contentType, originalFilename)) {
            logger.warn("Invalid file type: contentType={}, filename={}", contentType, originalFilename);
            throw new InvalidFileTypeException("Only PDF, JPEG, and PNG files are allowed");
        }
        
        // Generate S3 key: invoices/{venueId}/{timestamp}-{uuid}-{filename}
        String timestamp = String.valueOf(System.currentTimeMillis());
        String uuid = UUID.randomUUID().toString().substring(0, 8);
        String sanitizedFilename = sanitizeFilename(originalFilename);
        String s3Key = String.format("invoices/%s/%s-%s-%s", venueId, timestamp, uuid, sanitizedFilename);
        
        logger.info("Generated S3 key: {}", s3Key);
        
        try {
            // Upload to S3
            PutObjectRequest putRequest = PutObjectRequest.builder()
                    .bucket(invoicesBucket)
                    .key(s3Key)
                    .contentType(contentType)
                    .contentLength(file.getSize())
                    .build();
            
            s3Client.putObject(putRequest, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));
            logger.info("Successfully uploaded file to S3: bucket={}, key={}", invoicesBucket, s3Key);
            
        } catch (Exception e) {
            logger.error("Failed to upload file to S3: bucket={}, key={}", invoicesBucket, s3Key, e);
            throw new RuntimeException("Failed to upload file to S3: " + e.getMessage(), e);
        }
        
        // Create invoice record
        Invoice invoice = new Invoice(venueId, originalFilename, s3Key, uploadedBy);
        invoice.setProcessingStatus(InvoiceProcessingStatus.PENDING);
        Invoice savedInvoice = invoiceRepository.save(invoice);
        
        logger.info("Created invoice record: id={}", savedInvoice.getId());
        
        // Enqueue OCR processing message
        try {
            final UUID invoiceId = savedInvoice.getId();
            Map<String, Object> message = new HashMap<>();
            message.put("invoiceId", invoiceId.toString());
            message.put("venueId", venueId.toString());
            message.put("s3Bucket", invoicesBucket);
            message.put("s3Key", s3Key);
            
            sqsTemplate.send(to -> to
                    .queue(ocrProcessingQueue)
                    .payload(message)
                    .header("MessageGroupId", venueId.toString())
                    .header("MessageDeduplicationId", invoiceId.toString()));
            
            logger.info("Enqueued OCR processing message: invoiceId={}, queue={}", 
                       invoiceId, ocrProcessingQueue);
            
        } catch (Exception e) {
            logger.error("Failed to enqueue OCR processing message for invoice {}", savedInvoice.getId(), e);
            // Don't fail the upload if SQS fails - the message can be retried
            // Update status to indicate processing issue
            savedInvoice.setProcessingStatus(InvoiceProcessingStatus.FAILED);
            invoiceRepository.save(savedInvoice);
        }
        
        return savedInvoice;
    }
    
    /**
     * Validate file type based on content type and file extension.
     */
    private boolean isValidFileType(String contentType, String filename) {
        // Check content type
        boolean validContentType = contentType != null && ALLOWED_FILE_TYPES.contains(contentType.toLowerCase());
        
        // Check file extension
        boolean validExtension = false;
        if (filename != null && filename.contains(".")) {
            String extension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
            validExtension = ALLOWED_EXTENSIONS.contains(extension);
        }
        
        // Both must be valid (defense in depth)
        return validContentType && validExtension;
    }
    
    /**
     * Sanitize filename to prevent path traversal and other issues.
     */
    private String sanitizeFilename(String filename) {
        if (filename == null) {
            return "file";
        }
        
        // Remove path components
        String sanitized = filename.replaceAll("[\\\\/]", "");
        
        // Remove potentially dangerous characters
        sanitized = sanitized.replaceAll("[^a-zA-Z0-9._-]", "_");
        
        // Limit length
        if (sanitized.length() > 200) {
            String extension = "";
            int dotIndex = sanitized.lastIndexOf('.');
            if (dotIndex > 0) {
                extension = sanitized.substring(dotIndex);
                sanitized = sanitized.substring(0, 200 - extension.length()) + extension;
            } else {
                sanitized = sanitized.substring(0, 200);
            }
        }
        
        return sanitized;
    }
    
    /**
     * Get invoice history for a venue.
     * Requirements: 12.10
     */
    @Transactional(readOnly = true)
    public List<Invoice> getInvoiceHistory(UUID venueId) {
        return invoiceRepository.findByVenueIdOrderByUploadDateDesc(venueId);
    }
    
    /**
     * Get invoice by ID.
     */
    @Transactional(readOnly = true)
    public Optional<Invoice> getInvoiceById(UUID invoiceId) {
        return invoiceRepository.findById(invoiceId);
    }
    
    /**
     * Get invoice detail with line items for review.
     * Requirements: 12.7 (Invoice OCR Processing)
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @return the invoice with line items
     * @throws ResourceNotFoundException if invoice not found or doesn't belong to venue
     */
    @Transactional(readOnly = true)
    public Invoice getInvoiceDetail(UUID venueId, UUID invoiceId) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorCodes.INVOICE_NOT_FOUND,
                        String.format("Invoice with ID %s not found", invoiceId)));
        
        // Verify invoice belongs to the venue
        if (!invoice.getVenueId().equals(venueId)) {
            throw new ResourceNotFoundException(
                    ErrorCodes.INVOICE_NOT_FOUND,
                    String.format("Invoice with ID %s not found in venue %s", invoiceId, venueId));
        }
        
        return invoice;
    }
    
    /**
     * Update an invoice line item before confirmation.
     * Requirements: 12.8 (Invoice Line Item Review)
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @param lineItemId the line item ID
     * @param extractedName the corrected name
     * @param extractedQuantity the corrected quantity
     * @param extractedUnit the corrected unit
     * @param extractedPrice the corrected price
     * @return the updated line item
     * @throws ResourceNotFoundException if invoice or line item not found
     * @throws InvalidInvoiceStateException if invoice not in REVIEW status
     */
    @Transactional
    public InvoiceLineItem updateLineItem(
            UUID venueId,
            UUID invoiceId,
            UUID lineItemId,
            String extractedName,
            BigDecimal extractedQuantity,
            String extractedUnit,
            BigDecimal extractedPrice) {
        
        logger.info("Updating line item {} for invoice {} in venue {}", lineItemId, invoiceId, venueId);
        
        // Validate invoice exists and belongs to venue
        Invoice invoice = getInvoiceDetail(venueId, invoiceId);
        
        // Validate invoice is in REVIEW status
        if (invoice.getProcessingStatus() != InvoiceProcessingStatus.REVIEW) {
            throw new InvalidInvoiceStateException(
                    String.format("Cannot edit line items for invoice in status %s. Invoice must be in REVIEW status.",
                            invoice.getProcessingStatus()));
        }
        
        // Find the line item
        InvoiceLineItem lineItem = invoiceLineItemRepository.findByInvoiceIdAndId(invoiceId, lineItemId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorCodes.LINE_ITEM_NOT_FOUND,
                        String.format("Line item with ID %s not found for invoice %s", lineItemId, invoiceId)));
        
        // Update fields
        lineItem.setExtractedName(extractedName);
        lineItem.setExtractedQuantity(extractedQuantity);
        lineItem.setExtractedUnit(extractedUnit);
        lineItem.setExtractedPrice(extractedPrice);
        
        // If user manually edited, mark as no longer low confidence
        lineItem.setIsLowConfidence(false);
        lineItem.setConfidenceScore(new BigDecimal("1.000"));
        
        InvoiceLineItem updated = invoiceLineItemRepository.save(lineItem);
        logger.info("Updated line item {}", lineItemId);
        
        return updated;
    }
    
    /**
     * Confirm invoice and apply extracted data to ingredients.
     * Requirements: 12.8 (Invoice Confirmation), 12.9 (Low-Confidence Validation)
     * 
     * This method:
     * - Validates all low-confidence fields have been reviewed (no low-confidence items remain)
     * - For each line item, performs case-insensitive name match against ingredients
     * - Updates matched ingredients' purchase price and quantity
     * - Creates new ingredients for unmatched line items
     * - Triggers cost propagation for updated ingredients
     * - Updates invoice status to CONFIRMED
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @throws ResourceNotFoundException if invoice not found
     * @throws InvalidInvoiceStateException if invoice not in REVIEW status
     * @throws InvoiceConfirmationException if low-confidence fields remain
     */
    @Transactional
    public void confirmInvoice(UUID venueId, UUID invoiceId) {
        logger.info("Confirming invoice {} for venue {}", invoiceId, venueId);
        
        // Validate invoice exists and belongs to venue
        Invoice invoice = getInvoiceDetail(venueId, invoiceId);
        
        // Validate invoice is in REVIEW status
        if (invoice.getProcessingStatus() != InvoiceProcessingStatus.REVIEW) {
            throw new InvalidInvoiceStateException(
                    String.format("Cannot confirm invoice in status %s. Invoice must be in REVIEW status.",
                            invoice.getProcessingStatus()));
        }
        
        // Get all line items
        List<InvoiceLineItem> lineItems = invoice.getLineItems();
        
        if (lineItems.isEmpty()) {
            throw new InvoiceConfirmationException(
                    "Cannot confirm invoice with no line items",
                    Collections.emptyList());
        }
        
        // Validate no low-confidence fields remain - Requirement 12.9
        List<String> lowConfidenceItems = new ArrayList<>();
        for (InvoiceLineItem item : lineItems) {
            if (Boolean.TRUE.equals(item.getIsLowConfidence())) {
                lowConfidenceItems.add(item.getExtractedName());
            }
        }
        
        if (!lowConfidenceItems.isEmpty()) {
            throw new InvoiceConfirmationException(
                    "Cannot confirm invoice with low-confidence fields. Please review and correct these items: " 
                            + String.join(", ", lowConfidenceItems),
                    lowConfidenceItems);
        }
        
        // Process each line item - Requirement 12.8
        Set<UUID> updatedIngredientIds = new HashSet<>();
        
        for (InvoiceLineItem item : lineItems) {
            if (item.getStatus() == InvoiceLineItemStatus.DISMISSED) {
                logger.info("Skipping dismissed line item: {}", item.getExtractedName());
                continue;
            }
            
            String name = item.getExtractedName();
            BigDecimal quantity = item.getExtractedQuantity();
            BigDecimal price = item.getExtractedPrice();
            String unit = item.getExtractedUnit();
            
            // Skip if essential data is missing
            if (name == null || quantity == null || price == null) {
                logger.warn("Skipping line item with missing data: name={}, quantity={}, price={}",
                        name, quantity, price);
                continue;
            }
            
            // Try to match existing ingredient (case-insensitive)
            Optional<Ingredient> existingIngredient = 
                    ingredientRepository.findByVenueIdAndNameIgnoreCase(venueId, name);
            
            if (existingIngredient.isPresent()) {
                // Update existing ingredient
                Ingredient ingredient = existingIngredient.get();
                logger.info("Updating existing ingredient: {} ({})", ingredient.getName(), ingredient.getId());
                
                ingredient.setPurchasePrice(price);
                ingredient.setPurchaseQuantity(quantity);
                
                // Try to parse unit if provided
                if (unit != null && !unit.isBlank()) {
                    try {
                        UomEnum uom = UomEnum.valueOf(unit.toUpperCase());
                        ingredient.setUnitOfMeasure(uom);
                    } catch (IllegalArgumentException e) {
                        logger.warn("Invalid UOM '{}' for ingredient {}, keeping existing UOM", 
                                unit, ingredient.getName());
                    }
                }
                
                // Recalculate cost fields
                calculateAndSetCostFields(ingredient);
                ingredientRepository.save(ingredient);
                
                // Mark for cost propagation
                updatedIngredientIds.add(ingredient.getId());
                
                // Update line item
                item.setMatchedIngredientId(ingredient.getId());
                item.setStatus(InvoiceLineItemStatus.CONFIRMED);
                
            } else {
                // Create new ingredient
                logger.info("Creating new ingredient: {}", name);
                
                // Determine UOM - default to 'GRAM' if not provided or invalid
                UomEnum uom = UomEnum.GRAM;
                if (unit != null && !unit.isBlank()) {
                    try {
                        uom = UomEnum.valueOf(unit.toUpperCase());
                    } catch (IllegalArgumentException e) {
                        logger.warn("Invalid UOM '{}' for new ingredient {}, defaulting to grams", 
                                unit, name);
                    }
                }
                
                Ingredient newIngredient = new Ingredient(
                        venueId,
                        name,
                        price,
                        quantity,
                        uom,
                        new BigDecimal("100.00") // Default yield
                );
                
                // Calculate cost fields
                calculateAndSetCostFields(newIngredient);
                Ingredient saved = ingredientRepository.save(newIngredient);
                
                logger.info("Created new ingredient {} with ID {}", saved.getName(), saved.getId());
                
                // Update line item
                item.setMatchedIngredientId(saved.getId());
                item.setStatus(InvoiceLineItemStatus.CONFIRMED);
            }
        }
        
        // Update invoice status
        invoice.setProcessingStatus(InvoiceProcessingStatus.CONFIRMED);
        invoiceRepository.save(invoice);
        
        logger.info("Invoice {} confirmed. Updated {} ingredients, created {} new ingredients",
                invoiceId, updatedIngredientIds.size(), 
                lineItems.stream().filter(i -> i.getMatchedIngredientId() != null).count() - updatedIngredientIds.size());
        
        // Trigger cost propagation for updated ingredients
        for (UUID ingredientId : updatedIngredientIds) {
            try {
                costPropagationService.enqueue(venueId, ingredientId);
            } catch (Exception e) {
                logger.error("Failed to enqueue cost propagation for ingredient {}", ingredientId, e);
                // Don't fail the confirmation if propagation queueing fails
            }
        }
    }
    
    /**
     * Calculate and set cost fields for an ingredient.
     * Requirements: 1.2, 1.5
     */
    private void calculateAndSetCostFields(Ingredient ingredient) {
        BigDecimal costPerUnit = CostCalculator.costPerUnit(
                ingredient.getPurchasePrice(),
                ingredient.getPurchaseQuantity()
        );
        
        BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(
                costPerUnit,
                ingredient.getYieldPercentage()
        );
        
        ingredient.setCostPerUnit(costPerUnit);
        ingredient.setEffectiveCostPerUsableUnit(effectiveCost);
    }
}
