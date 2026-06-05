package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request DTO for creating a new venue.
 * Requirements: 10.1, 10.2
 */
public class CreateVenueRequest {
    
    @NotBlank(message = "Venue name is required")
    @Size(min = 1, max = 100, message = "Venue name must be between 1 and 100 characters")
    private String name;
    
    private String address;
    
    public CreateVenueRequest() {
    }
    
    public CreateVenueRequest(String name, String address) {
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
