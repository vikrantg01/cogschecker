package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.domain.InvoiceLineItem;
import com.cogschecker.foodcost.api.domain.InvoiceProcessingStatus;
import com.cogschecker.foodcost.api.repository.InvoiceRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awspring.cloud.sqs.annotation.SqsListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.textract.TextractClient;
import software.amazon.awssdk.services.textract.model.*;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Worker for processing invoice OCR using AWS Textract.
 * <p>
 * This worker:
 * <ol>
 *   <li>Listens to the ocr-processing SQS FIFO queue</li>
 *   <li>Fetches invoice file from S3</li>
 *   <li>Calls AWS Textract AnalyzeDocument with TABLES feature</li>
 *   <li>Parses table blocks into invoice_line_items</li>
 *   <li>Sets confidence scores for each field</li>
 *   <li>Flags is_low_confidence when score < 0.80</li>
 *   <li>Updates invoice status to REVIEW</li>
 * </ol>
 * <p>
 * Requirements: 12.7 (Invoice OCR Processing), 12.9 (Confidence Scoring)
 */
@Component
public class OcrProcessingWorker {
    
    private static final Logger logger = LoggerFactory.getLogger(OcrProcessingWorker.class);
    
    private static final BigDecimal CONFIDENCE_THRESHOLD = new BigDecimal("0.80");
    private static final int MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    
    private final InvoiceRepository invoiceRepository;
    private final TextractClient textractClient;
    private final S3Client s3Client;
    private final ObjectMapper objectMapper;
    
    @Value("${aws.textract.confidence-threshold:0.80}")
    private BigDecimal configuredConfidenceThreshold;
    
    public OcrProcessingWorker(
            InvoiceRepository invoiceRepository,
            TextractClient textractClient,
            S3Client s3Client,
            ObjectMapper objectMapper) {
        this.invoiceRepository = invoiceRepository;
        this.textractClient = textractClient;
        this.s3Client = s3Client;
        this.objectMapper = objectMapper;
    }
    
    /**
     * Process OCR requests from the SQS queue.
     * <p>
     * Message payload format:
     * <pre>
     * {
     *   "invoiceId": "uuid",
     *   "venueId": "uuid",
     *   "s3Bucket": "bucket-name",
     *   "s3Key": "invoices/venue-id/timestamp-uuid-filename.pdf"
     * }
     * </pre>
     * <p>
     * Requirements: 12.7 - OCR processing via SQS
     * 
     * @param message the SQS message payload
     */
    @SqsListener("${sqs.queue.ocr-processing}")
    public void processOcrRequest(Map<String, String> message) {
        String invoiceIdStr = message.get("invoiceId");
        String venueIdStr = message.get("venueId");
        String s3Bucket = message.get("s3Bucket");
        String s3Key = message.get("s3Key");
        
        logger.info("Received OCR processing request: invoiceId={}, venueId={}, s3Bucket={}, s3Key={}",
                invoiceIdStr, venueIdStr, s3Bucket, s3Key);
        
        if (invoiceIdStr == null || s3Bucket == null || s3Key == null) {
            logger.error("Invalid message payload: invoiceId, s3Bucket, and s3Key are required");
            throw new IllegalArgumentException("Invalid message payload: required fields missing");
        }
        
        UUID invoiceId;
        try {
            invoiceId = UUID.fromString(invoiceIdStr);
        } catch (IllegalArgumentException e) {
            logger.error("Invalid UUID format in message: invoiceId={}", invoiceIdStr);
            throw new IllegalArgumentException("Invalid UUID format in message payload", e);
        }
        
        try {
            processInvoice(invoiceId, s3Bucket, s3Key);
            logger.info("Successfully completed OCR processing for invoice {}", invoiceId);
        } catch (Exception e) {
            logger.error("OCR processing failed for invoice {}: {}", invoiceId, e.getMessage(), e);
            markInvoiceAsFailed(invoiceId);
            throw new RuntimeException("OCR processing failed for invoice " + invoiceId, e);
        }
    }
    
    /**
     * Process a single invoice: fetch from S3, run Textract, parse results, save line items.
     * <p>
     * Requirements: 12.7, 12.8, 12.9
     * 
     * @param invoiceId the invoice ID
     * @param s3Bucket the S3 bucket name
     * @param s3Key the S3 object key
     */
    @Transactional
    public void processInvoice(UUID invoiceId, String s3Bucket, String s3Key) {
        logger.info("Processing invoice {}: bucket={}, key={}", invoiceId, s3Bucket, s3Key);
        
        // Step 1: Fetch invoice record
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new RuntimeException("Invoice not found: " + invoiceId));
        
        // Update status to PROCESSING
        invoice.setProcessingStatus(InvoiceProcessingStatus.PROCESSING);
        invoiceRepository.save(invoice);
        
        try {
            // Step 2: Fetch file from S3
            byte[] documentBytes = fetchDocumentFromS3(s3Bucket, s3Key);
            
            logger.info("Fetched document from S3: size={} bytes", documentBytes.length);
            
            // Step 3: Call Textract AnalyzeDocument
            AnalyzeDocumentResponse textractResponse = analyzeDocumentWithTextract(documentBytes);
            
            logger.info("Textract analysis completed: {} blocks found", textractResponse.blocks().size());
            
            // Step 4: Parse table blocks into line items
            List<InvoiceLineItem> lineItems = parseTableBlocks(invoice, textractResponse.blocks());
            
            logger.info("Parsed {} line items from Textract response", lineItems.size());
            
            // Step 5: Save line items
            invoice.getLineItems().clear();
            invoice.getLineItems().addAll(lineItems);
            invoice.setExtractedItemCount(lineItems.size());
            
            // Step 6: Update invoice status to REVIEW
            invoice.setProcessingStatus(InvoiceProcessingStatus.REVIEW);
            invoiceRepository.save(invoice);
            
            logger.info("Invoice {} processing completed: {} items extracted, status=REVIEW",
                    invoiceId, lineItems.size());
            
        } catch (Exception e) {
            logger.error("Failed to process invoice {}: {}", invoiceId, e.getMessage(), e);
            invoice.setProcessingStatus(InvoiceProcessingStatus.FAILED);
            invoiceRepository.save(invoice);
            throw new RuntimeException("Failed to process invoice", e);
        }
    }
    
    /**
     * Fetch document bytes from S3.
     * 
     * @param bucket the S3 bucket name
     * @param key the S3 object key
     * @return the document bytes
     */
    private byte[] fetchDocumentFromS3(String bucket, String key) {
        try {
            GetObjectRequest getRequest = GetObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build();
            
            byte[] bytes = s3Client.getObject(getRequest).readAllBytes();
            
            if (bytes.length > MAX_FILE_SIZE) {
                throw new RuntimeException("File size exceeds maximum: " + bytes.length + " bytes");
            }
            
            return bytes;
            
        } catch (Exception e) {
            logger.error("Failed to fetch document from S3: bucket={}, key={}", bucket, key, e);
            throw new RuntimeException("Failed to fetch document from S3", e);
        }
    }
    
    /**
     * Call AWS Textract AnalyzeDocument with TABLES feature.
     * <p>
     * Requirements: 12.7 - Textract TABLES feature
     * 
     * @param documentBytes the document bytes
     * @return the Textract response
     */
    private AnalyzeDocumentResponse analyzeDocumentWithTextract(byte[] documentBytes) {
        try {
            Document document = Document.builder()
                    .bytes(SdkBytes.fromByteArray(documentBytes))
                    .build();
            
            AnalyzeDocumentRequest request = AnalyzeDocumentRequest.builder()
                    .document(document)
                    .featureTypes(FeatureType.TABLES)  // TABLES feature for extracting table data
                    .build();
            
            AnalyzeDocumentResponse response = textractClient.analyzeDocument(request);
            
            logger.debug("Textract response: documentMetadata={}, blocks={}",
                    response.documentMetadata(), response.blocks().size());
            
            return response;
            
        } catch (Exception e) {
            logger.error("Textract AnalyzeDocument failed", e);
            throw new RuntimeException("Textract AnalyzeDocument failed", e);
        }
    }
    
    /**
     * Parse Textract table blocks into invoice line items.
     * <p>
     * This method:
     * <ol>
     *   <li>Identifies TABLE blocks</li>
     *   <li>Extracts rows from each table</li>
     *   <li>Maps columns to ingredient fields (name, quantity, unit, price)</li>
     *   <li>Creates InvoiceLineItem entities with confidence scores</li>
     *   <li>Flags low-confidence items (< 0.80)</li>
     * </ol>
     * <p>
     * Requirements: 12.7, 12.9
     * 
     * @param invoice the invoice entity
     * @param blocks the Textract blocks
     * @return list of parsed line items
     */
    private List<InvoiceLineItem> parseTableBlocks(Invoice invoice, List<Block> blocks) {
        List<InvoiceLineItem> lineItems = new ArrayList<>();
        
        // Build block ID map for quick lookup
        Map<String, Block> blockMap = blocks.stream()
                .collect(Collectors.toMap(Block::id, block -> block));
        
        // Find all TABLE blocks
        List<Block> tables = blocks.stream()
                .filter(block -> block.blockType() == BlockType.TABLE)
                .collect(Collectors.toList());
        
        logger.info("Found {} table(s) in document", tables.size());
        
        for (Block table : tables) {
            // Extract rows from table
            List<List<Block>> rows = extractTableRows(table, blockMap);
            
            logger.info("Table has {} rows", rows.size());
            
            // Skip header row (first row) - assume it contains column names
            for (int i = 1; i < rows.size(); i++) {
                List<Block> row = rows.get(i);
                
                // Parse row into line item
                InvoiceLineItem lineItem = parseTableRow(invoice, row, blockMap);
                
                if (lineItem != null) {
                    lineItems.add(lineItem);
                }
            }
        }
        
        return lineItems;
    }
    
    /**
     * Extract rows from a table block.
     * Each row is a list of CELL blocks.
     * 
     * @param table the TABLE block
     * @param blockMap map of block IDs to blocks
     * @return list of rows, where each row is a list of CELL blocks
     */
    private List<List<Block>> extractTableRows(Block table, Map<String, Block> blockMap) {
        Map<Integer, List<Block>> rowMap = new HashMap<>();
        
        if (table.relationships() != null) {
            for (Relationship relationship : table.relationships()) {
                if (relationship.type() == RelationshipType.CHILD) {
                    for (String cellId : relationship.ids()) {
                        Block cell = blockMap.get(cellId);
                        
                        if (cell != null && cell.blockType() == BlockType.CELL) {
                            int rowIndex = cell.rowIndex() != null ? cell.rowIndex() : 0;
                            
                            rowMap.computeIfAbsent(rowIndex, k -> new ArrayList<>()).add(cell);
                        }
                    }
                }
            }
        }
        
        // Sort rows by row index
        return rowMap.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> {
                    // Sort cells within row by column index
                    List<Block> cells = entry.getValue();
                    cells.sort(Comparator.comparing(cell -> cell.columnIndex() != null ? cell.columnIndex() : 0));
                    return cells;
                })
                .collect(Collectors.toList());
    }
    
    /**
     * Parse a table row into an InvoiceLineItem.
     * <p>
     * Expected columns (flexible order detection):
     * - Ingredient name (text)
     * - Quantity (numeric)
     * - Unit (text: kg, g, ml, L, etc.)
     * - Price (numeric with currency symbol)
     * <p>
     * Requirements: 12.7, 12.9
     * 
     * @param invoice the invoice entity
     * @param row the row cells
     * @param blockMap map of block IDs to blocks
     * @return parsed line item, or null if row is invalid
     */
    private InvoiceLineItem parseTableRow(Invoice invoice, List<Block> row, Map<String, Block> blockMap) {
        if (row.isEmpty()) {
            return null;
        }
        
        InvoiceLineItem lineItem = new InvoiceLineItem();
        lineItem.setInvoice(invoice);
        
        List<BigDecimal> confidenceScores = new ArrayList<>();
        
        // Parse each cell and try to identify the field type
        String name = null;
        BigDecimal quantity = null;
        String unit = null;
        BigDecimal price = null;
        
        for (Block cell : row) {
            String cellText = extractCellText(cell, blockMap);
            Float cellConfidence = cell.confidence();
            
            if (cellText == null || cellText.trim().isEmpty()) {
                continue;
            }
            
            cellText = cellText.trim();
            
            // Try to identify field type based on content
            if (name == null && !isNumeric(cellText) && !isCurrency(cellText)) {
                // Likely ingredient name (first non-numeric column)
                name = cellText;
                if (cellConfidence != null) {
                    confidenceScores.add(BigDecimal.valueOf(cellConfidence / 100.0));
                }
            } else if (quantity == null && isNumeric(cellText)) {
                // Likely quantity (first numeric column)
                try {
                    quantity = new BigDecimal(cellText.replaceAll("[^0-9.]", ""));
                    if (cellConfidence != null) {
                        confidenceScores.add(BigDecimal.valueOf(cellConfidence / 100.0));
                    }
                } catch (NumberFormatException e) {
                    logger.debug("Failed to parse quantity: {}", cellText);
                }
            } else if (unit == null && isUnit(cellText)) {
                // Likely unit of measure
                unit = cellText;
                if (cellConfidence != null) {
                    confidenceScores.add(BigDecimal.valueOf(cellConfidence / 100.0));
                }
            } else if (price == null && isCurrency(cellText)) {
                // Likely price (numeric with currency symbol)
                try {
                    price = new BigDecimal(cellText.replaceAll("[^0-9.]", ""));
                    if (cellConfidence != null) {
                        confidenceScores.add(BigDecimal.valueOf(cellConfidence / 100.0));
                    }
                } catch (NumberFormatException e) {
                    logger.debug("Failed to parse price: {}", cellText);
                }
            }
        }
        
        // Require at least name and price
        if (name == null && price == null) {
            logger.debug("Skipping row: no name or price found");
            return null;
        }
        
        // Set extracted fields
        lineItem.setExtractedName(name);
        lineItem.setExtractedQuantity(quantity);
        lineItem.setExtractedUnit(unit);
        lineItem.setExtractedPrice(price);
        
        // Calculate average confidence score
        BigDecimal avgConfidence = confidenceScores.isEmpty()
                ? BigDecimal.ZERO
                : confidenceScores.stream()
                        .reduce(BigDecimal.ZERO, BigDecimal::add)
                        .divide(BigDecimal.valueOf(confidenceScores.size()), 3, BigDecimal.ROUND_HALF_UP);
        
        lineItem.setConfidenceScore(avgConfidence);
        
        // Flag low confidence (< 0.80)
        BigDecimal threshold = configuredConfidenceThreshold != null 
                ? configuredConfidenceThreshold 
                : CONFIDENCE_THRESHOLD;
        lineItem.setIsLowConfidence(avgConfidence.compareTo(threshold) < 0);
        
        logger.debug("Parsed line item: name={}, quantity={}, unit={}, price={}, confidence={}, lowConfidence={}",
                name, quantity, unit, price, avgConfidence, lineItem.getIsLowConfidence());
        
        return lineItem;
    }
    
    /**
     * Extract text content from a CELL block by concatenating its WORD children.
     * 
     * @param cell the CELL block
     * @param blockMap map of block IDs to blocks
     * @return the concatenated text
     */
    private String extractCellText(Block cell, Map<String, Block> blockMap) {
        StringBuilder text = new StringBuilder();
        
        if (cell.relationships() != null) {
            for (Relationship relationship : cell.relationships()) {
                if (relationship.type() == RelationshipType.CHILD) {
                    for (String wordId : relationship.ids()) {
                        Block word = blockMap.get(wordId);
                        
                        if (word != null && word.blockType() == BlockType.WORD && word.text() != null) {
                            if (text.length() > 0) {
                                text.append(" ");
                            }
                            text.append(word.text());
                        }
                    }
                }
            }
        }
        
        return text.toString();
    }
    
    /**
     * Check if a string is numeric.
     */
    private boolean isNumeric(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        // Remove common numeric separators
        String cleaned = text.replaceAll("[,\\s]", "");
        
        try {
            Double.parseDouble(cleaned);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }
    
    /**
     * Check if a string contains currency (price).
     */
    private boolean isCurrency(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        // Check for currency symbols or patterns
        return text.matches(".*[$£€¥₹].*") || text.matches(".*\\d+\\.\\d{2}.*");
    }
    
    /**
     * Check if a string is a unit of measure.
     */
    private boolean isUnit(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        
        String lower = text.toLowerCase().trim();
        
        // Common unit abbreviations
        Set<String> units = Set.of(
                "g", "kg", "gram", "grams", "kilogram", "kilograms",
                "ml", "l", "millilitre", "millilitres", "litre", "litres",
                "oz", "lb", "ounce", "ounces", "pound", "pounds",
                "tsp", "tbsp", "cup", "teaspoon", "tablespoon",
                "each", "ea", "pcs", "piece", "pieces"
        );
        
        return units.contains(lower);
    }
    
    /**
     * Mark invoice as failed.
     * 
     * @param invoiceId the invoice ID
     */
    private void markInvoiceAsFailed(UUID invoiceId) {
        try {
            Optional<Invoice> invoiceOpt = invoiceRepository.findById(invoiceId);
            if (invoiceOpt.isPresent()) {
                Invoice invoice = invoiceOpt.get();
                invoice.setProcessingStatus(InvoiceProcessingStatus.FAILED);
                invoiceRepository.save(invoice);
                logger.info("Marked invoice {} as FAILED", invoiceId);
            }
        } catch (Exception e) {
            logger.error("Failed to update invoice {} status to FAILED", invoiceId, e);
        }
    }
}
