package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.domain.InvoiceProcessingStatus;
import com.cogschecker.foodcost.api.exception.FileSizeExceededException;
import com.cogschecker.foodcost.api.exception.InvalidFileTypeException;
import com.cogschecker.foodcost.api.repository.InvoiceRepository;
import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;

import java.io.IOException;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for InvoiceService.
 * Requirements: 12.6 (Invoice Upload file type and size validation)
 */
@ExtendWith(MockitoExtension.class)
class InvoiceServiceTest {
    
    @Mock
    private InvoiceRepository invoiceRepository;
    
    @Mock
    private S3Client s3Client;
    
    @Mock
    private SqsTemplate sqsTemplate;
    
    private InvoiceService invoiceService;
    
    private static final String TEST_BUCKET = "test-invoices-bucket";
    private static final String TEST_QUEUE = "test-ocr-queue";
    
    @BeforeEach
    void setUp() {
        invoiceService = new InvoiceService(invoiceRepository, s3Client, sqsTemplate);
        ReflectionTestUtils.setField(invoiceService, "invoicesBucket", TEST_BUCKET);
        ReflectionTestUtils.setField(invoiceService, "ocrProcessingQueue", TEST_QUEUE);
    }
    
    @Test
    void uploadInvoice_withValidPdf_shouldSucceed() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.pdf",
                "application/pdf",
                "test pdf content".getBytes()
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.pdf", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        Invoice result = invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        assertNotNull(result);
        assertEquals(InvoiceProcessingStatus.PENDING, result.getProcessingStatus());
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        verify(invoiceRepository, times(1)).save(any(Invoice.class));
        verify(sqsTemplate, times(1)).send(any());
    }
    
    @Test
    void uploadInvoice_withValidJpeg_shouldSucceed() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.jpg",
                "image/jpeg",
                new byte[1024]
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.jpg", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        Invoice result = invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        assertNotNull(result);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }
    
    @Test
    void uploadInvoice_withValidPng_shouldSucceed() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.png",
                "image/png",
                new byte[1024]
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.png", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        Invoice result = invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        assertNotNull(result);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }
    
    @Test
    void uploadInvoice_withInvalidFileType_shouldThrowException() {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.txt",
                "text/plain",
                "test content".getBytes()
        );
        
        // When & Then
        assertThrows(InvalidFileTypeException.class, () -> {
            invoiceService.uploadInvoice(venueId, file, userId);
        });
        
        verify(s3Client, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        verify(invoiceRepository, never()).save(any(Invoice.class));
    }
    
    @Test
    void uploadInvoice_withFileSizeExceeded_shouldThrowException() {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        
        // Create a file larger than 10 MB
        byte[] largeContent = new byte[11 * 1024 * 1024]; // 11 MB
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "large-invoice.pdf",
                "application/pdf",
                largeContent
        );
        
        // When & Then
        assertThrows(FileSizeExceededException.class, () -> {
            invoiceService.uploadInvoice(venueId, file, userId);
        });
        
        verify(s3Client, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
        verify(invoiceRepository, never()).save(any(Invoice.class));
    }
    
    @Test
    void uploadInvoice_withExactly10MB_shouldSucceed() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        
        // Create a file exactly 10 MB
        byte[] content = new byte[10 * 1024 * 1024];
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "max-size-invoice.pdf",
                "application/pdf",
                content
        );
        
        Invoice savedInvoice = new Invoice(venueId, "max-size-invoice.pdf", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        Invoice result = invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        assertNotNull(result);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }
    
    @Test
    void uploadInvoice_withMixedCaseExtension_shouldSucceed() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.PDF",
                "application/pdf",
                new byte[1024]
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.PDF", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        Invoice result = invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        assertNotNull(result);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }
    
    @Test
    void uploadInvoice_shouldGenerateUniqueS3Key() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.pdf",
                "application/pdf",
                new byte[1024]
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.pdf", "s3-key", userId);
        savedInvoice.setId(UUID.randomUUID());
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        ArgumentCaptor<PutObjectRequest> requestCaptor = ArgumentCaptor.forClass(PutObjectRequest.class);
        verify(s3Client).putObject(requestCaptor.capture(), any(RequestBody.class));
        
        PutObjectRequest request = requestCaptor.getValue();
        assertTrue(request.key().startsWith("invoices/" + venueId + "/"));
        assertTrue(request.key().endsWith("invoice.pdf"));
        assertEquals(TEST_BUCKET, request.bucket());
    }
    
    @Test
    void uploadInvoice_shouldEnqueueOCRMessage() throws IOException {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID invoiceId = UUID.randomUUID();
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "invoice.pdf",
                "application/pdf",
                new byte[1024]
        );
        
        Invoice savedInvoice = new Invoice(venueId, "invoice.pdf", "s3-key", userId);
        savedInvoice.setId(invoiceId);
        
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());
        when(invoiceRepository.save(any(Invoice.class))).thenReturn(savedInvoice);
        
        // When
        invoiceService.uploadInvoice(venueId, file, userId);
        
        // Then
        verify(sqsTemplate, times(1)).send(any());
    }
}
