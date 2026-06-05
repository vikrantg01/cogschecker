package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for User entity.
 * Requirements: 9.7 (user management)
 */
@Repository
public interface UserRepository extends JpaRepository<User, UUID> {
    
    /**
     * Find user by email (case-insensitive).
     */
    Optional<User> findByEmailIgnoreCase(String email);
    
    /**
     * Check if user exists by email (case-insensitive).
     */
    boolean existsByEmailIgnoreCase(String email);
}
