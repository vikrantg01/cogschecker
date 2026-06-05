package com.cogschecker.foodcost.api.migration;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Test class to verify V3 migration file structure and content.
 * Requirements: 12.6 (Invoice Upload), 12.10 (Invoice History), 13.1 (AI Insights)
 * 
 * Note: These tests validate the migration file structure without executing SQL.
 * Full migration execution is tested in integration tests with real PostgreSQL.
 */
class V3MigrationTest {

    private static final String MIGRATION_FILE_PATH = "src/main/resources/db/migration/V3__create_pro_proplus_tables.sql";

    @Test
    void testMigrationFileExists() {
        Path migrationPath = Paths.get(MIGRATION_FILE_PATH);
        assertThat(migrationPath).exists();
    }

    @Test
    void testMigrationFileContainsInvoicesTable() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        assertThat(content).contains("CREATE TABLE invoices");
        assertThat(content).contains("venue_id");
        assertThat(content).contains("file_name");
        assertThat(content).contains("s3_key");
        assertThat(content).contains("processing_status");
    }

    @Test
    void testMigrationFileContainsInvoiceLineItemsTable() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        assertThat(content).contains("CREATE TABLE invoice_line_items");
        assertThat(content).contains("invoice_id");
        assertThat(content).contains("extracted_name");
        assertThat(content).contains("confidence_score");
        assertThat(content).contains("matched_ingredient_id");
    }

    @Test
    void testMigrationFileContainsSquareConnectionsTable() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        assertThat(content).contains("CREATE TABLE square_connections");
        assertThat(content).contains("square_merchant_id");
        assertThat(content).contains("access_token_encrypted");
        assertThat(content).contains("refresh_token_encrypted");
        assertThat(content).contains("UNIQUE"); // venue_id should be unique
    }

    @Test
    void testMigrationFileContainsSquareUnmatchedItemsTable() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        assertThat(content).contains("CREATE TABLE square_unmatched_items");
        assertThat(content).contains("square_item_name");
        assertThat(content).contains("mapped_recipe_id");
    }

    @Test
    void testMigrationFileContainsAiInsightsTable() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        assertThat(content).contains("CREATE TABLE ai_insights");
        assertThat(content).contains("insight_type");
        assertThat(content).contains("supporting_data");
        assertThat(content).contains("JSONB");
        assertThat(content).contains("recommended_action");
    }

    @Test
    void testMigrationFileContainsForeignKeys() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify foreign key relationships
        assertThat(content).contains("REFERENCES venues(id)");
        assertThat(content).contains("REFERENCES users(id)");
        assertThat(content).contains("REFERENCES invoices(id)");
        assertThat(content).contains("REFERENCES ingredients(id)");
        assertThat(content).contains("REFERENCES recipes(id)");
    }

    @Test
    void testMigrationFileContainsCascadeDeletes() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify ON DELETE CASCADE for proper cleanup
        assertThat(content).contains("ON DELETE CASCADE");
    }

    @Test
    void testMigrationFileContainsIndexes() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify proper indexing for performance
        assertThat(content).contains("CREATE INDEX idx_invoices_venue_id");
        assertThat(content).contains("CREATE INDEX idx_invoice_line_items_invoice_id");
        assertThat(content).contains("CREATE INDEX idx_square_connections_venue_id");
        assertThat(content).contains("CREATE INDEX idx_square_unmatched_items_venue_id");
        assertThat(content).contains("CREATE INDEX idx_ai_insights_venue_id");
    }

    @Test
    void testMigrationFileContainsUpdatedAtTriggers() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify all tables have updated_at triggers
        assertThat(content).contains("CREATE TRIGGER update_invoices_updated_at");
        assertThat(content).contains("CREATE TRIGGER update_invoice_line_items_updated_at");
        assertThat(content).contains("CREATE TRIGGER update_square_connections_updated_at");
        assertThat(content).contains("CREATE TRIGGER update_square_unmatched_items_updated_at");
        assertThat(content).contains("CREATE TRIGGER update_ai_insights_updated_at");
    }

    @Test
    void testMigrationFileContainsCheckConstraints() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify enum-like constraints
        assertThat(content).containsIgnoringCase("CHECK (processing_status IN");
        assertThat(content).containsIgnoringCase("CHECK (status IN");
        assertThat(content).containsIgnoringCase("CHECK (insight_type IN");
        assertThat(content).containsIgnoringCase("CHECK (sync_status IN");
    }

    @Test
    void testMigrationFileContainsTableComments() throws IOException {
        String content = Files.readString(Paths.get(MIGRATION_FILE_PATH));
        // Verify documentation comments exist
        assertThat(content).contains("COMMENT ON TABLE invoices");
        assertThat(content).contains("COMMENT ON TABLE invoice_line_items");
        assertThat(content).contains("COMMENT ON TABLE square_connections");
        assertThat(content).contains("COMMENT ON TABLE square_unmatched_items");
        assertThat(content).contains("COMMENT ON TABLE ai_insights");
    }
}
