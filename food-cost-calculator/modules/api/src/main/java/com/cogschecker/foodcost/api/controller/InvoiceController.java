package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.dto.InvoiceUploadResponse;
import com.cogschecker.foodcost.api.exception.FileSizeExceededException;
import com.cogschecker.foodcost.api.exception.InvalidFileTypeException;
import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import com.cogschecker.foodcost.api.service.InvoiceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;

/**
 * REST controller for invoice upload and management endpoints.
 * Requirements: 12.6 (Invoice Upload), 12.7 (OCR Processing), 12.10 (Invoice History)
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/invoices")
public class InvoiceController {
    
    private static final Logger logger = LoggerFactory.getLogger(InvoiceController.class);
    
    private final InvoiceService invoiceService;
    
    public InvoiceController(InvoiceService invoiceService) {
        this.invoiceService = invoiceService;
    }
    
    /**
     * Upload a supplier invoice file for OCR processing.
     * POST /venues/:venueId/invoices
     * 
     * Requirements: 12.6, 12.7
     * 
     * Validates file type (PDF, JPEG, PNG) and size (≤ 10 MB).
     * Uploads to S3, creates invoice record, enqueues OCR processing.
     * Returns immediately without waiting for OCR to complete.
     * 
     * Pro/Pro+ tier only. Admin and Manager roles only.
     * 
     * @param venueId the venue ID
     * @param file the uploaded file (multipart form data)
     * @param currentUser the authenticated user
     * @return invoice upload response with invoiceId and status "processing"
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<InvoiceUploadResponse> uploadInvoice(
            @PathVariable UUID venueId,
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal CognitoAuthenticationToken principal) {
        
        UUID userId = UUID.fromString(principal.getUserId());
        
        logger.info("Upload invoice request: venueId={}, userId={}, filename={}, size={}", 
                   venueId, userId, file.getOriginalFilename(), file.getSize());
        
        // Validate file is not empty
        if (file.isEmpty()) {
            throw new InvalidFileTypeException("File is empty");
        }
        
        try {
            // Upload file, create record, enqueue OCR processing
            Invoice invoice = invoiceService.uploadInvoice(
                    venueId, 
                    file, 
                    userId);
            
            // Return response immediately (fire-and-forget to OCR worker)
            InvoiceUploadResponse response = new InvoiceUploadResponse(
                    invoice.getId(),
                    "processing"
            );
            
            logger.info("Invoice upload successful: invoiceId={}, status={}", 
                       invoice.getId(), invoice.getProcessingStatus());
            
            return ResponseEntity.status(HttpStatus.CREATED).body(response);
            
        } catch (InvalidFileTypeException | FileSizeExceededException e) {
            // These are user errors - let GlobalExceptionHandler map them to 400
            logger.warn("Invalid file upload for venue {}: {}", venueId, e.getMessage());
            throw e;
            
        } catch (IOException e) {
            logger.error("Failed to read uploaded file for venue {}", venueId, e);
            throw new RuntimeException("Failed to read uploaded file: " + e.getMessage(), e);
            
        } catch (Exception e) {
            logger.error("Failed to upload invoice for venue {}", venueId, e);
            throw new RuntimeException("Failed to upload invoice: " + e.getMessage(), e);
        }
    }
}
