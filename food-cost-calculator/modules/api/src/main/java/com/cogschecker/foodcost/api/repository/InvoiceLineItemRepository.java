package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.InvoiceLineItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for InvoiceLineItem entity operations.
 * Requirements: 12.7 (Invoice OCR Processing), 12.8 (Line Item Review)
 */
@Repository
public interface InvoiceLineItemRepository extends JpaRepository<InvoiceLineItem, UUID> {
    
    /**
     * Find all line items for an invoice.
     */
    List<InvoiceLineItem> findByInvoiceId(UUID invoiceId);
    
    /**
     * Find a specific line item by invoice ID and line item ID.
     */
    Optional<InvoiceLineItem> findByInvoiceIdAndId(UUID invoiceId, UUID lineItemId);
}
