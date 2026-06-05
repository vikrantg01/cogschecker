package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.domain.InvoiceProcessingStatus;
import com.cogschecker.foodcost.api.exception.InvalidFileTypeException;
import com.cogschecker.foodcost.api.exception.FileSizeExceededException;
import com.cogschecker.foodcost.api.repository.InvoiceRepository;
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
    private final S3Client s3Client;
    private final SqsTemplate sqsTemplate;
    
    @Value("${s3.bucket.invoices}")
    private String invoicesBucket;
    
    @Value("${sqs.queue.ocr-processing}")
    private String ocrProcessingQueue;
    
    public InvoiceService(
            InvoiceRepository invoiceRepository,
            S3Client s3Client,
            SqsTemplate sqsTemplate) {
        this.invoiceRepository = invoiceRepository;
        this.s3Client = s3Client;
        this.sqsTemplate = sqsTemplate;
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
}
