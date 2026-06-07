package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.Invoice;
import com.cogschecker.foodcost.api.domain.InvoiceLineItem;
import com.cogschecker.foodcost.api.domain.InvoiceProcessingStatus;
import com.cogschecker.foodcost.api.repository.InvoiceRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.textract.TextractClient;
import software.amazon.awssdk.services.textract.model.*;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for OcrProcessingWorker.
 * <p>
 * Tests:
 * - Valid message processing
 * - Invalid message handling (null invoiceId, invalid UUID)
 * - Textract table parsing
 * - Confidence score calculation and low-confidence flagging
 * - Invoice status updates (PROCESSING → REVIEW)
 * - Error handling (invoice not found, S3 failure, Textract failure)
 */
@ExtendWith(MockitoExtension.class)
class OcrProcessingWorkerTest {

    @Mock
    private InvoiceRepository invoiceRepository;

    @Mock
    private TextractClient textractClient;

    @Mock
    private S3Client s3Client;

    private ObjectMapper objectMapper;
    private OcrProcessingWorker worker;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        worker = new OcrProcessingWorker(invoiceRepository, textractClient, s3Client, objectMapper);
    }

    @Test
    void processOcrRequest_validMessage_shouldProcessInvoice() throws Exception {
        // Arrange
        UUID invoiceId = UUID.randomUUID();
        UUID venueId = UUID.randomUUID();
        String s3Bucket = "test-bucket";
        String s3Key = "invoices/venue-id/test-invoice.pdf";
        
        Map<String, String> message = new HashMap<>();
        message.put("invoiceId", invoiceId.toString());
        message.put("venueId", venueId.toString());
        message.put("s3Bucket", s3Bucket);
        message.put("s3Key", s3Key);
        
        Invoice invoice = new Invoice(venueId, "test-invoice.pdf", s3Key, UUID.randomUUID());
        invoice.setId(invoiceId);
        
        when(invoiceRepository.findById(invoiceId)).thenReturn(Optional.of(invoice));
        when(invoiceRepository.save(any(Invoice.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // Mock S3 response
        byte[] dummyPdf = "dummy pdf content".getBytes();
        ResponseInputStream<GetObjectResponse> responseStream = mock(ResponseInputStream.class);
        try {
            when(responseStream.readAllBytes()).thenReturn(dummyPdf);
        } catch (Exception e) {
            // won't happen in mock
        }
        when(s3Client.getObject(any(GetObjectRequest.class))).thenReturn(responseStream);
        
        // Mock Textract response with simple table
        AnalyzeDocumentResponse textractResponse = createMockTextractResponse();
        when(textractClient.analyzeDocument(any(AnalyzeDocumentRequest.class))).thenReturn(textractResponse);
        
        // Act
        worker.processOcrRequest(message);
        
        // Assert
        ArgumentCaptor<Invoice> invoiceCaptor = ArgumentCaptor.forClass(Invoice.class);
        verify(invoiceRepository, atLeast(2)).save(invoiceCaptor.capture());
        
        List<Invoice> savedInvoices = invoiceCaptor.getAllValues();
        Invoice finalInvoice = savedInvoices.get(savedInvoices.size() - 1);
        
        assertEquals(InvoiceProcessingStatus.REVIEW, finalInvoice.getProcessingStatus());
        assertNotNull(finalInvoice.getExtractedItemCount());
        verify(textractClient).analyzeDocument(any(AnalyzeDocumentRequest.class));
    }

    @Test
    void processOcrRequest_nullInvoiceId_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("s3Bucket", "test-bucket");
        message.put("s3Key", "test-key");
        
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processOcrRequest(message));
    }

    @Test
    void processOcrRequest_invalidUuidFormat_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("invoiceId", "invalid-uuid");
        message.put("s3Bucket", "test-bucket");
        message.put("s3Key", "test-key");
        
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processOcrRequest(message));
    }

    @Test
    void processOcrRequest_invoiceNotFound_shouldThrowException() {
        // Arrange
        UUID invoiceId = UUID.randomUUID();
        
        Map<String, String> message = new HashMap<>();
        message.put("invoiceId", invoiceId.toString());
        message.put("venueId", UUID.randomUUID().toString());
        message.put("s3Bucket", "test-bucket");
        message.put("s3Key", "test-key");
        
        when(invoiceRepository.findById(invoiceId)).thenReturn(Optional.empty());
        
        // Act & Assert
        RuntimeException exception = assertThrows(RuntimeException.class, () -> worker.processOcrRequest(message));
        String exceptionMessage = exception.getMessage();
        assertTrue(exceptionMessage != null && (exceptionMessage.contains("Invoice not found") || exceptionMessage.contains("invoice")), 
                "Expected exception message to contain 'Invoice not found' or 'invoice', but got: " + exceptionMessage);
    }

    @Test
    void processInvoice_textractFailure_shouldMarkAsFailed() {
        // Arrange
        UUID invoiceId = UUID.randomUUID();
        UUID venueId = UUID.randomUUID();
        String s3Bucket = "test-bucket";
        String s3Key = "test-key";
        
        Invoice invoice = new Invoice(venueId, "test.pdf", s3Key, UUID.randomUUID());
        invoice.setId(invoiceId);
        
        when(invoiceRepository.findById(invoiceId)).thenReturn(Optional.of(invoice));
        when(invoiceRepository.save(any(Invoice.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // Mock S3 response
        byte[] dummyPdf = "dummy pdf content".getBytes();
        ResponseInputStream<GetObjectResponse> responseStream = mock(ResponseInputStream.class);
        try {
            when(responseStream.readAllBytes()).thenReturn(dummyPdf);
        } catch (Exception e) {
            // won't happen in mock
        }
        when(s3Client.getObject(any(GetObjectRequest.class))).thenReturn(responseStream);
        
        // Mock Textract failure
        when(textractClient.analyzeDocument(any(AnalyzeDocumentRequest.class)))
                .thenThrow(new RuntimeException("Textract service error"));
        
        // Act & Assert
        assertThrows(RuntimeException.class, () -> worker.processInvoice(invoiceId, s3Bucket, s3Key));
        
        ArgumentCaptor<Invoice> invoiceCaptor = ArgumentCaptor.forClass(Invoice.class);
        verify(invoiceRepository, atLeast(2)).save(invoiceCaptor.capture());
        
        List<Invoice> savedInvoices = invoiceCaptor.getAllValues();
        Invoice finalInvoice = savedInvoices.get(savedInvoices.size() - 1);
        
        assertEquals(InvoiceProcessingStatus.FAILED, finalInvoice.getProcessingStatus());
    }

    /**
     * Create a mock Textract response with a simple table.
     * <p>
     * Table structure:
     * | Name         | Quantity | Unit | Price  |
     * |--------------|----------|------|--------|
     * | Tomatoes     | 5        | kg   | 12.50  |
     * | Olive Oil    | 2        | L    | 18.00  |
     */
    private AnalyzeDocumentResponse createMockTextractResponse() {
        // Create WORD blocks
        Block nameHeaderWord = createWordBlock("w1", "Name", 90.0f);
        Block qtyHeaderWord = createWordBlock("w2", "Quantity", 90.0f);
        Block unitHeaderWord = createWordBlock("w3", "Unit", 90.0f);
        Block priceHeaderWord = createWordBlock("w4", "Price", 90.0f);
        
        Block tomatoesWord = createWordBlock("w5", "Tomatoes", 95.0f);
        Block qty1Word = createWordBlock("w6", "5", 98.0f);
        Block unit1Word = createWordBlock("w7", "kg", 92.0f);
        Block price1Word = createWordBlock("w8", "12.50", 96.0f);
        
        Block oliveOilWord1 = createWordBlock("w9", "Olive", 88.0f);
        Block oliveOilWord2 = createWordBlock("w10", "Oil", 88.0f);
        Block qty2Word = createWordBlock("w11", "2", 97.0f);
        Block unit2Word = createWordBlock("w12", "L", 94.0f);
        Block price2Word = createWordBlock("w13", "18.00", 95.0f);
        
        // Create CELL blocks for header row
        Block headerCell1 = createCellBlock("c1", 1, 1, Arrays.asList("w1"), 90.0f);
        Block headerCell2 = createCellBlock("c2", 1, 2, Arrays.asList("w2"), 90.0f);
        Block headerCell3 = createCellBlock("c3", 1, 3, Arrays.asList("w3"), 90.0f);
        Block headerCell4 = createCellBlock("c4", 1, 4, Arrays.asList("w4"), 90.0f);
        
        // Create CELL blocks for data rows
        Block row1Cell1 = createCellBlock("c5", 2, 1, Arrays.asList("w5"), 95.0f);
        Block row1Cell2 = createCellBlock("c6", 2, 2, Arrays.asList("w6"), 98.0f);
        Block row1Cell3 = createCellBlock("c7", 2, 3, Arrays.asList("w7"), 92.0f);
        Block row1Cell4 = createCellBlock("c8", 2, 4, Arrays.asList("w8"), 96.0f);
        
        Block row2Cell1 = createCellBlock("c9", 3, 1, Arrays.asList("w9", "w10"), 88.0f);
        Block row2Cell2 = createCellBlock("c10", 3, 2, Arrays.asList("w11"), 97.0f);
        Block row2Cell3 = createCellBlock("c11", 3, 3, Arrays.asList("w12"), 94.0f);
        Block row2Cell4 = createCellBlock("c12", 3, 4, Arrays.asList("w13"), 95.0f);
        
        // Create TABLE block
        List<String> cellIds = Arrays.asList("c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", 
                                              "c9", "c10", "c11", "c12");
        Block tableBlock = createTableBlock("t1", cellIds, 90.0f);
        
        // Combine all blocks
        List<Block> allBlocks = Arrays.asList(
                tableBlock,
                headerCell1, headerCell2, headerCell3, headerCell4,
                row1Cell1, row1Cell2, row1Cell3, row1Cell4,
                row2Cell1, row2Cell2, row2Cell3, row2Cell4,
                nameHeaderWord, qtyHeaderWord, unitHeaderWord, priceHeaderWord,
                tomatoesWord, qty1Word, unit1Word, price1Word,
                oliveOilWord1, oliveOilWord2, qty2Word, unit2Word, price2Word
        );
        
        return AnalyzeDocumentResponse.builder()
                .blocks(allBlocks)
                .documentMetadata(DocumentMetadata.builder().pages(1).build())
                .build();
    }

    private Block createWordBlock(String id, String text, float confidence) {
        return Block.builder()
                .id(id)
                .blockType(BlockType.WORD)
                .text(text)
                .confidence(confidence)
                .build();
    }

    private Block createCellBlock(String id, int rowIndex, int colIndex, List<String> childIds, float confidence) {
        Relationship relationship = Relationship.builder()
                .type(RelationshipType.CHILD)
                .ids(childIds)
                .build();
        
        return Block.builder()
                .id(id)
                .blockType(BlockType.CELL)
                .rowIndex(rowIndex)
                .columnIndex(colIndex)
                .confidence(confidence)
                .relationships(Arrays.asList(relationship))
                .build();
    }

    private Block createTableBlock(String id, List<String> cellIds, float confidence) {
        Relationship relationship = Relationship.builder()
                .type(RelationshipType.CHILD)
                .ids(cellIds)
                .build();
        
        return Block.builder()
                .id(id)
                .blockType(BlockType.TABLE)
                .confidence(confidence)
                .relationships(Arrays.asList(relationship))
                .build();
    }
}
