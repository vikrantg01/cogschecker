package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Invoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for Invoice entity operations.
 * Requirements: 12.6 (Invoice Upload), 12.10 (Invoice History)
 */
@Repository
public interface InvoiceRepository extends JpaRepository<Invoice, UUID> {
    
    /**
     * Find all invoices for a venue, ordered by upload date descending.
     */
    List<Invoice> findByVenueIdOrderByUploadDateDesc(UUID venueId);
}
