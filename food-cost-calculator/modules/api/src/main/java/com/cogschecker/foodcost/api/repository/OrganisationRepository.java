package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Organisation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Repository for Organisation entity.
 */
@Repository
public interface OrganisationRepository extends JpaRepository<Organisation, UUID> {
}
