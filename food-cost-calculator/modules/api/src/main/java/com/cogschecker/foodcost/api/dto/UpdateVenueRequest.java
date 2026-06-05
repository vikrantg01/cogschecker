package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.Size;

/**
 * Request DTO for updating a venue.
 * Requirements: 10.1, 10.8
 */
public class UpdateVenueRequest {
    
    @Size(min = 1, max = 100, message = "Venue name must be between 1 and 100 characters")
    private String name;
    
    private String address;
    
    public UpdateVenueRequest() {
    }
    
    public UpdateVenueRequest(String name, String address) {
        this.name = name;
        this.address = address;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public String getAddress() {
        return address;
    }
    
    public void setAddress(String address) {
        this.address = address;
    }
}
