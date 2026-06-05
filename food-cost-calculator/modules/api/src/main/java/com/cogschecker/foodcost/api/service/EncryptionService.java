package com.cogschecker.foodcost.api.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.kms.model.DecryptRequest;
import software.amazon.awssdk.services.kms.model.DecryptResponse;
import software.amazon.awssdk.services.kms.model.EncryptRequest;
import software.amazon.awssdk.services.kms.model.EncryptResponse;

import java.nio.charset.StandardCharsets;

/**
 * Service for encrypting and decrypting sensitive data using AWS KMS.
 * Uses envelope encryption with KMS Customer Managed Keys.
 * Requirements: 12.1 (Square OAuth token encryption)
 */
@Service
public class EncryptionService {
    
    private static final Logger logger = LoggerFactory.getLogger(EncryptionService.class);
    
    private final KmsClient kmsClient;
    private final String squareTokenKeyId;
    
    public EncryptionService(
            KmsClient kmsClient,
            @Value("${aws.kms.square-token-key-id:}") String squareTokenKeyId) {
        this.kmsClient = kmsClient;
        this.squareTokenKeyId = squareTokenKeyId;
    }
    
    /**
     * Encrypt a plaintext string using the Square token KMS key.
     * 
     * @param plaintext the plaintext to encrypt
     * @return encrypted bytes
     * @throws RuntimeException if encryption fails
     */
    public byte[] encryptSquareToken(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            throw new IllegalArgumentException("Plaintext cannot be null or empty");
        }
        
        if (squareTokenKeyId == null || squareTokenKeyId.isEmpty()) {
            throw new IllegalStateException("Square token KMS key ID is not configured");
        }
        
        try {
            EncryptRequest request = EncryptRequest.builder()
                    .keyId(squareTokenKeyId)
                    .plaintext(SdkBytes.fromString(plaintext, StandardCharsets.UTF_8))
                    .build();
            
            EncryptResponse response = kmsClient.encrypt(request);
            byte[] encrypted = response.ciphertextBlob().asByteArray();
            
            logger.debug("Successfully encrypted Square token using KMS key {}", squareTokenKeyId);
            return encrypted;
        } catch (Exception e) {
            logger.error("Failed to encrypt Square token using KMS", e);
            throw new RuntimeException("Failed to encrypt Square token", e);
        }
    }
    
    /**
     * Decrypt encrypted bytes using the Square token KMS key.
     * 
     * @param ciphertext the encrypted bytes
     * @return decrypted plaintext string
     * @throws RuntimeException if decryption fails
     */
    public String decryptSquareToken(byte[] ciphertext) {
        if (ciphertext == null || ciphertext.length == 0) {
            throw new IllegalArgumentException("Ciphertext cannot be null or empty");
        }
        
        try {
            DecryptRequest request = DecryptRequest.builder()
                    .ciphertextBlob(SdkBytes.fromByteArray(ciphertext))
                    .build();
            
            DecryptResponse response = kmsClient.decrypt(request);
            String plaintext = response.plaintext().asString(StandardCharsets.UTF_8);
            
            logger.debug("Successfully decrypted Square token using KMS");
            return plaintext;
        } catch (Exception e) {
            logger.error("Failed to decrypt Square token using KMS", e);
            throw new RuntimeException("Failed to decrypt Square token", e);
        }
    }
}
