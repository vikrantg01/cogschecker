package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.domain.InvoiceLineItem;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.exception.FileSizeExceededException;
import com.cogschecker.foodcost.api.exception.InvalidFileTypeException;
import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import com.cogschecker.foodcost.api.service.InvoiceService;
import jakarta.validation.Valid;
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
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

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
    
    /**
     * Get invoice detail with line items for review.
     * GET /venues/:venueId/invoices/:id
     * 
     * Requirements: 12.7 (Invoice OCR Processing)
     * 
     * Returns invoice details including all line items with OCR results,
     * confidence scores, and low-confidence flags.
     * 
     * Pro/Pro+ tier only. Admin and Manager roles only.
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @return invoice detail response with line items
     */
    @GetMapping("/{invoiceId}")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<InvoiceDetailResponse> getInvoiceDetail(
            @PathVariable UUID venueId,
            @PathVariable UUID invoiceId) {
        
        logger.info("Get invoice detail request: venueId={}, invoiceId={}", venueId, invoiceId);
        
        Invoice invoice = invoiceService.getInvoiceDetail(venueId, invoiceId);
        
        // Convert to response DTO
        List<InvoiceLineItemResponse> lineItemResponses = invoice.getLineItems().stream()
                .map(this::toLineItemResponse)
                .collect(Collectors.toList());
        
        InvoiceDetailResponse response = new InvoiceDetailResponse(
                invoice.getId(),
                invoice.getVenueId(),
                invoice.getFileName(),
                invoice.getUploadDate(),
                invoice.getProcessingStatus().name(),
                invoice.getExtractedItemCount(),
                lineItemResponses
        );
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Update an invoice line item before confirmation.
     * PATCH /venues/:venueId/invoices/:id/lines/:lineId
     * 
     * Requirements: 12.8 (Invoice Line Item Review)
     * 
     * Allows users to edit/correct individual line items extracted from OCR
     * before confirming the invoice. Only allowed when invoice is in REVIEW status.
     * 
     * Pro/Pro+ tier only. Admin and Manager roles only.
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @param lineId the line item ID
     * @param request the update request with corrected values
     * @return updated line item response
     */
    @PatchMapping("/{invoiceId}/lines/{lineId}")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<InvoiceLineItemResponse> updateLineItem(
            @PathVariable UUID venueId,
            @PathVariable UUID invoiceId,
            @PathVariable UUID lineId,
            @Valid @RequestBody UpdateInvoiceLineItemRequest request) {
        
        logger.info("Update line item request: venueId={}, invoiceId={}, lineId={}", 
                   venueId, invoiceId, lineId);
        
        InvoiceLineItem updated = invoiceService.updateLineItem(
                venueId,
                invoiceId,
                lineId,
                request.getExtractedName(),
                request.getExtractedQuantity(),
                request.getExtractedUnit(),
                request.getExtractedPrice()
        );
        
        InvoiceLineItemResponse response = toLineItemResponse(updated);
        
        logger.info("Line item {} updated successfully", lineId);
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Confirm invoice and apply extracted data to ingredients.
     * POST /venues/:venueId/invoices/:id/confirm
     * 
     * Requirements: 12.8 (Invoice Confirmation), 12.9 (Low-Confidence Validation)
     * 
     * Confirms the invoice after user review. This operation:
     * - Validates all low-confidence fields have been reviewed
     * - Performs case-insensitive name matching against existing ingredients
     * - Updates matched ingredients' purchase price and quantity
     * - Creates new ingredients for unmatched line items
     * - Triggers cost propagation for updated ingredients
     * - Updates invoice status to CONFIRMED
     * 
     * Only allowed when invoice is in REVIEW status.
     * 
     * Pro/Pro+ tier only. Admin and Manager roles only.
     * 
     * @param venueId the venue ID
     * @param invoiceId the invoice ID
     * @return success message response
     */
    @PostMapping("/{invoiceId}/confirm")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<MessageResponse> confirmInvoice(
            @PathVariable UUID venueId,
            @PathVariable UUID invoiceId) {
        
        logger.info("Confirm invoice request: venueId={}, invoiceId={}", venueId, invoiceId);
        
        invoiceService.confirmInvoice(venueId, invoiceId);
        
        logger.info("Invoice {} confirmed successfully", invoiceId);
        
        MessageResponse response = new MessageResponse(
                "Invoice confirmed successfully. Ingredients have been updated."
        );
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Helper method to convert InvoiceLineItem entity to DTO.
     */
    private InvoiceLineItemResponse toLineItemResponse(InvoiceLineItem lineItem) {
        return new InvoiceLineItemResponse(
                lineItem.getId(),
                lineItem.getExtractedName(),
                lineItem.getExtractedQuantity(),
                lineItem.getExtractedUnit(),
                lineItem.getExtractedPrice(),
                lineItem.getConfidenceScore(),
                lineItem.getIsLowConfidence(),
                lineItem.getMatchedIngredientId(),
                lineItem.getStatus().name()
        );
    }
}
