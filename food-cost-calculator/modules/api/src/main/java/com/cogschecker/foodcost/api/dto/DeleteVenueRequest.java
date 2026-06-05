package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.AssertTrue;

/**
 * Request DTO for deleting a venue.
 * Requirements: 10.8
 */
public class DeleteVenueRequest {
    
    @AssertTrue(message = "Explicit confirmation is required to delete a venue")
    private Boolean confirmed;
    
    public DeleteVenueRequest() {
    }
    
    public DeleteVenueRequest(Boolean confirmed) {
        this.confirmed = confirmed;
    }
    
    public Boolean getConfirmed() {
        return confirmed;
    }
    
    public void setConfirmed(Boolean confirmed) {
        this.confirmed = confirmed;
    }
}
