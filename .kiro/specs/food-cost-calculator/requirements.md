# Requirements Document

## Introduction

A food cost calculator for cafes and restaurants that enables owners and kitchen managers to manage recipes, track ingredient costs, and calculate accurate food cost percentages. The system supports multiple venues under a single account, with role-based access control for Admin, Manager, and Staff users. Users authenticate via email/password or social login providers. The system allows users to build a library of ingredients with pricing, compose recipes from those ingredients, and analyze profitability by comparing food costs against menu selling prices.

## Glossary

- **System**: The Food Cost Calculator application
- **Recipe**: A named list of ingredients with quantities used to produce one or more servings of a menu item
- **Ingredient**: A purchasable raw material with a unit cost and unit of measure
- **Food Cost**: The total cost of ingredients required to produce one serving of a recipe
- **Food Cost Percentage**: The ratio of food cost to menu selling price, expressed as a percentage
- **Menu Price**: The selling price of a menu item as charged to customers
- **Yield**: The usable quantity of an ingredient after preparation (e.g., trimming, cooking loss), expressed as a percentage
- **Unit of Measure (UOM)**: The measurement unit used for an ingredient (e.g., grams, ml, each)
- **Recipe Library**: The collection of all saved recipes within the system
- **Ingredient Library**: The collection of all saved ingredients with their costs within the system
- **Portion**: A single serving quantity of a finished recipe
- **Sub-Recipe**: A recipe used as an ingredient within another recipe (e.g., a sauce used inside a dish)
- **Venue**: A single physical cafe or restaurant location belonging to an organisation
- **Organisation**: A top-level account that owns one or more Venues
- **Admin**: A user role with full access to all Venues and organisation-level settings within their Organisation
- **Manager**: A user role with full access to a specific Venue's data (ingredients, recipes, reports) but no access to other Venues or organisation settings
- **Staff**: A user role with read-only access to the Recipe Library and Ingredient Library for their assigned Venue; cannot create, edit, or delete data
- **Social Login**: Authentication via a third-party identity provider (Google or Apple)
- **Subscription Tier**: The plan level associated with an Organisation — one of Free, Pro, or Pro+
- **Free Tier**: The default plan; includes manual data entry, up to 2 Venues, and up to 25 recipes per Venue
- **Pro Tier**: Paid plan that adds Square POS integration and supplier invoice upload for automated ingredient pricing
- **Pro+ Tier**: Paid plan that includes all Pro features plus AI-driven insights on recipe profitability and supplier cost management based on sales data
- **Square POS**: A point-of-sale platform used to record sales transactions, integrated to sync menu item sales data into the System
- **Invoice Upload**: The ability to upload a supplier invoice document (PDF or image) from which the System extracts ingredient names and prices automatically

---

## Requirements

### Requirement 1: Ingredient Management

**User Story:** As a cafe or restaurant owner, I want to manage a library of ingredients with their costs, so that I can maintain accurate and up-to-date pricing for all raw materials used in my kitchen.

#### Acceptance Criteria

1. THE System SHALL allow users to create an ingredient entry with a name (1–100 characters), a purchase price (greater than 0), a purchase quantity (greater than 0), and a unit of measure selected from the supported UOM list.
2. WHEN a user creates an ingredient, THE System SHALL calculate and store the cost per unit as: purchase price ÷ purchase quantity, rounded to 4 decimal places.
3. WHEN a user updates the purchase price or purchase quantity of an ingredient, THE System SHALL recalculate and store the cost per unit automatically within 1 second of the change being saved.
4. THE System SHALL allow users to specify a yield percentage for each ingredient as a value between 1 and 100 (inclusive); the default yield SHALL be 100%.
5. WHEN a yield percentage is set for an ingredient, THE System SHALL calculate the effective cost per usable unit as: cost per unit ÷ (yield percentage ÷ 100), rounded to 4 decimal places.
6. THE System SHALL allow users to edit any field of an existing ingredient in the Ingredient Library and save the changes.
7. THE System SHALL allow users to delete an ingredient from the Ingredient Library.
8. IF a user attempts to delete an ingredient that is referenced by one or more recipes or sub-recipes, THEN THE System SHALL display a warning that lists the names of all affected recipes and require explicit confirmation before proceeding with the deletion; THE System SHALL block the deletion unless both the warning has been displayed and the user has confirmed — confirmation alone without a prior warning display SHALL NOT permit deletion.
9. THE System SHALL allow users to search the Ingredient Library by ingredient name using a case-insensitive partial-match search, and SHALL display all matching results within 1 second.
10. IF a user attempts to create or save an ingredient with a name that already exists in the Ingredient Library (case-insensitive), THEN THE System SHALL display a duplicate-name error and prevent saving until the name is changed.

---

### Requirement 2: Recipe Management

**User Story:** As a kitchen manager, I want to create and manage recipes by selecting ingredients and specifying quantities, so that I can maintain a structured Recipe Library for all menu items.

#### Acceptance Criteria

1. THE System SHALL allow users to create a recipe with a name (1–100 non-whitespace characters), a portion count (integer between 1 and 9999 inclusive), and up to 200 ingredient lines.
2. WHEN a user adds an ingredient line to a recipe, THE System SHALL allow the user to specify the ingredient (selected from the Ingredient Library), the quantity used (greater than 0), and the unit of measure for that line.
3. THE System SHALL allow users to add a Sub-Recipe as an ingredient line within another recipe.
4. IF a user attempts to add a Sub-Recipe as an ingredient line that would create a circular reference (i.e., the Sub-Recipe directly or transitively references the parent recipe), THEN THE System SHALL display an error and prevent the addition.
5. THE System SHALL allow users to edit the name, portion count, or any ingredient line within a saved recipe.
6. WHEN a user duplicates an existing recipe, THE System SHALL create a copy with the name prefixed "Copy of [original name]" and allow the user to rename it before saving.
7. THE System SHALL allow users to delete a recipe from the Recipe Library.
8. IF a user attempts to delete a recipe that is used as a Sub-Recipe in one or more other recipes, THEN THE System SHALL display a warning listing the affected parent recipes and require explicit confirmation before proceeding.
9. THE System SHALL allow users to search the Recipe Library by recipe name using a case-insensitive partial-match search, and SHALL display all matching results within 1 second.
10. WHEN a user saves a recipe, THE System SHALL validate that: the recipe name is non-empty and non-whitespace, the portion count is between 1 and 9999, and all ingredient lines have a quantity greater than zero.
11. IF any validation condition in criterion 10 is not met, THEN THE System SHALL display a validation error identifying each failing field and SHALL prevent saving until all errors are resolved.
12. WHEN a user on the Free Tier attempts to save a recipe that would cause the total recipe count for that Venue to exceed 25, THE System SHALL display an upgrade prompt explaining the Free Tier limit and prevent the save until the user upgrades to Pro or deletes an existing recipe.

---

### Requirement 3: Food Cost Calculation

**User Story:** As a cafe or restaurant owner, I want the system to automatically calculate the food cost for each recipe, so that I can understand the exact cost of producing each menu item.

#### Acceptance Criteria

1. WHEN a recipe is viewed or saved, THE System SHALL calculate the total recipe batch cost by summing (quantity used × effective cost per usable unit) for each ingredient line, applying UOM conversions where needed.
2. THE System SHALL calculate the food cost per portion as: total recipe batch cost ÷ number of portions, rounded to 2 decimal places, and SHALL display this value on the recipe detail view.
3. WHEN the purchase price, purchase quantity, or yield percentage of an ingredient is updated, THE System SHALL recalculate the food cost per portion for all recipes that directly or transitively reference that ingredient within 2 seconds of the update being saved.
4. WHEN a Sub-Recipe is used as an ingredient line, THE System SHALL use the Sub-Recipe's calculated food cost per portion as the unit cost for that line before applying the specified quantity.
5. THE System SHALL display the food cost breakdown for a recipe, showing each ingredient line's name, quantity, UOM, unit cost, and individual cost contribution, along with the total batch cost and food cost per portion; THE System SHALL always display the breakdown structure even when some or all ingredient prices are missing, substituting "—" or equivalent placeholder values for unavailable cost fields.
6. IF a recipe references an ingredient that has no purchase price set (price = 0 or not entered), THEN THE System SHALL flag that ingredient line with a visible warning indicator, exclude it from the total cost calculation, and display a warning message stating which ingredient is missing a price.
7. IF all ingredient lines in a recipe are flagged as missing price data, THEN THE System SHALL display the food cost per portion as "Incomplete — missing ingredient prices" rather than a numeric value.

---

### Requirement 4: Food Cost Percentage Analysis

**User Story:** As a restaurant owner, I want to set a menu selling price for each recipe and see the food cost percentage, so that I can evaluate and manage the profitability of each menu item.

#### Acceptance Criteria

1. THE System SHALL allow users to enter a menu selling price for each recipe as a positive numeric value greater than 0, stored to 2 decimal places; IF a user enters a value that is zero, negative, or less than 0.01, THEN THE System SHALL display a validation error and reject the input without saving.
2. WHEN a menu selling price greater than 0 is entered for a recipe, THE System SHALL calculate the Food Cost Percentage as: (food cost per portion ÷ menu selling price) × 100, rounded to 1 decimal place.
3. IF the menu selling price for a recipe is 0 or not set, THEN THE System SHALL display the Food Cost Percentage as "N/A" to prevent division by zero.
4. THE System SHALL display the Food Cost Percentage alongside the food cost per portion and menu selling price on the recipe detail view.
5. WHEN the food cost per portion or the menu selling price changes, THE System SHALL recalculate and update the displayed Food Cost Percentage within 1 second.
6. THE System SHALL allow users to set a target Food Cost Percentage threshold as a system-wide default, entered as a value between 1 and 100 (inclusive), with a default of 30%.
7. WHEN a recipe's Food Cost Percentage exceeds the target threshold, THE System SHALL display a visual indicator (e.g., a colour-coded badge or icon) on that recipe in both the recipe detail view and the Recipe Library list.
8. WHEN a recipe's Food Cost Percentage is at or below the target threshold, THE System SHALL display a passing visual indicator distinguishable from the exceeding indicator.

---

### Requirement 5: Recipe Costing Report

**User Story:** As a cafe owner, I want to view a summary report of all recipes with their costs and food cost percentages, so that I can quickly identify high-cost items and make informed pricing decisions.

#### Acceptance Criteria

1. THE System SHALL provide a recipe costing report view that lists all recipes with their food cost per portion, menu selling price, and Food Cost Percentage; recipes without a menu selling price SHALL display "N/A" for Food Cost Percentage; THE System SHALL enforce that all displayed recipes have non-empty names and non-negative food cost and menu selling price values before inclusion in the report.
2. WHEN a user selects a sort column (recipe name, food cost per portion, menu selling price, or Food Cost Percentage), THE System SHALL sort the report by that column in ascending order; selecting the same column again SHALL toggle the sort to descending order.
3. THE System SHALL display the report sorted by recipe name in ascending order by default.
4. WHEN a user applies the "exceeds threshold" filter, THE System SHALL display only recipes where the Food Cost Percentage exceeds the system-wide target threshold; recipes with no menu selling price SHALL be excluded from the filtered results.
5. IF the filtered report contains no matching recipes, THE System SHALL display a message stating "No recipes exceed the target threshold."
6. WHEN a user requests a CSV export, THE System SHALL generate and download a CSV file containing one row per recipe with the columns: Recipe Name, Food Cost Per Portion, Menu Price, Food Cost Percentage, Portions Per Batch; numeric values SHALL be rounded to 2 decimal places and Food Cost Percentage to 1 decimal place.
7. WHEN the report is filtered before export, THE System SHALL export only the currently filtered rows.

---

### Requirement 6: Unit of Measure Handling

**User Story:** As a kitchen manager, I want the system to handle different units of measure consistently, so that ingredient quantities in recipes always match the units used for ingredient pricing.

#### Acceptance Criteria

1. THE System SHALL support the following units of measure, grouped by measurement dimension — Weight: grams (g), kilograms (kg), ounce (oz), pound (lb); Volume: millilitres (ml), litres (L), teaspoon (tsp), tablespoon (tbsp), cup; Count: each.
2. WHEN an ingredient line is added to a recipe using a unit within the same measurement dimension as the ingredient's purchase unit, THE System SHALL convert the quantity to the purchase unit using the exact conversion factors defined in criterion 3 before calculating the ingredient line cost.
3. THE System SHALL apply the following exact conversion factors: 1 kg = 1000 g; 1 L = 1000 ml; 1 tsp = 5 ml; 1 tbsp = 15 ml; 1 cup = 240 ml; 1 oz = 28.3495 g; 1 lb = 453.592 g.
4. IF a user selects a unit for a recipe ingredient line that belongs to a different measurement dimension than the ingredient's purchase unit (e.g., a weight unit for an ingredient purchased by volume, or a volume unit for an ingredient purchased by count), THEN THE System SHALL display an incompatible-unit error message specifying the conflicting dimensions and SHALL prevent saving the recipe line.
5. THE System SHALL treat the "each" unit as its own measurement dimension (count); it SHALL NOT be convertible to or from any weight or volume unit.

---

### Requirement 7: Data Persistence

**User Story:** As a user, I want my ingredient library and recipes to be saved persistently, so that my data is retained between sessions.

#### Acceptance Criteria

1. THE System SHALL automatically persist all ingredients (name, price, quantity, UOM, yield), recipes (name, portions, ingredient lines), menu selling prices, and the target Food Cost Percentage threshold after every create, update, or delete operation, without requiring a manual save action.
2. WHEN the application is opened or refreshed, THE System SHALL restore all previously persisted ingredients, recipes, menu selling prices, and the target threshold so that the state matches the state at the end of the previous session.
3. IF the application detects that persisted data is corrupted or unavailable — whether at startup or during a data load operation — THEN THE System SHALL immediately display an error message indicating that data could not be loaded and offer the user the option to reset to an empty state or retry loading.
4. THE System SHALL allow users to export all data — ingredients, recipes, menu selling prices, and the target threshold — as a single JSON file download.
5. WHEN a user imports a JSON file, THE System SHALL validate the file against the expected data schema; IF the file is valid, THE System SHALL replace all existing data with the imported data and display a success confirmation.
6. IF an imported JSON file is malformed, contains invalid JSON syntax, or does not conform to the expected data schema, THEN THE System SHALL display an error message indicating the cause of rejection and SHALL leave all existing data unchanged.
7. WHEN a user exports data and then imports that same exported file on the same or a different instance of the application, THE System SHALL restore all ingredients (all fields), all recipes (all fields and ingredient lines), all menu selling prices, and the target threshold to values identical to those present at the time of export; this round-trip integrity guarantee applies only to files produced by the system's own export function.

---

### Requirement 8: User Authentication

**User Story:** As a cafe or restaurant owner, I want to sign in with my email or social media account, so that my data is secure and accessible only to authorised users.

#### Acceptance Criteria

1. THE System SHALL allow users to register an account using an email address and password; the password SHALL be at least 8 characters and contain at least one uppercase letter, one lowercase letter, and one number.
2. THE System SHALL allow users to sign in using their registered email address and password.
3. THE System SHALL allow users to authenticate using Google as a social login provider.
4. THE System SHALL allow users to authenticate using Apple as a social login provider.
5. WHEN a user authenticates via a social login provider for the first time, THE System SHALL create a new account linked to that provider identity and prompt the user to complete any required profile fields (e.g., display name).
6. WHEN a user authenticates via a social login provider whose email matches an existing email-based account, THE System SHALL link the social provider to the existing account rather than creating a duplicate.
7. THE System SHALL allow users to request a password reset by entering their registered email address; WHEN a valid email is submitted, THE System SHALL send a password reset link to that address within 2 minutes.
8. IF a user submits an unrecognised email address on the password reset form, THE System SHALL display a generic confirmation message without revealing whether the email exists in the system.
9. THE System SHALL invalidate all active sessions for a user when they change their password.
10. WHEN a user has not interacted with the application for 30 consecutive days, THE System SHALL require re-authentication before granting access.

---

### Requirement 9: Role-Based Access Control

**User Story:** As an Admin, I want to assign roles to users so that each person has access only to the data and actions appropriate for their responsibilities.

#### Acceptance Criteria

1. THE System SHALL support exactly three roles: Admin, Manager, and Staff; every authenticated user SHALL be assigned exactly one role per Venue they are granted access to.
2. THE System SHALL grant Admin users full create, read, update, and delete access to all Venues within their Organisation, including organisation-level settings, user management, and all ingredient and recipe data across all Venues.
3. THE System SHALL grant Manager users full create, read, update, and delete access to ingredient and recipe data within their assigned Venue(s) only; Managers SHALL NOT access other Venues' data or organisation-level settings.
4. THE System SHALL grant Staff users read-only access to the Ingredient Library and Recipe Library for their assigned Venue(s); Staff SHALL NOT create, edit, delete, or export any data.
5. IF a user with a Staff role attempts to perform a create, update, delete, or export action, THEN THE System SHALL display a permission-denied message and block the action.
6. WHEN an Admin assigns or changes a user's role, THE System SHALL apply the new permissions immediately for all active sessions of that user.
7. THE System SHALL allow Admins to invite new users to the Organisation by email, specifying their role and Venue assignment(s) at the time of invitation.
8. WHEN an invited user accepts an invitation, THE System SHALL associate their account with the Organisation and assign the specified role and Venue access.
9. THE System SHALL allow Admins to remove a user's access to the Organisation; WHEN access is removed, THE System SHALL invalidate all active sessions for that user within the Organisation.
10. THE System SHALL prevent an Admin from removing their own Admin role if they are the sole Admin of the Organisation.

---

### Requirement 10: Multi-Venue Management

**User Story:** As a cafe or restaurant owner with multiple locations, I want to manage each venue separately under one account, so that I can track and compare costs across all my sites.

#### Acceptance Criteria

1. THE System SHALL allow an Admin to create one or more Venues within their Organisation, each with a unique name (1–100 characters) and an optional address.
2. WHEN an Admin on the Free Tier attempts to create a third Venue, THE System SHALL display an upgrade prompt explaining the Free Tier 2-venue limit and prevent creation until the Organisation upgrades to Pro or Pro+.
3. THE System SHALL scope all ingredient and recipe data to the Venue in which it was created; data from one Venue SHALL NOT be visible to users of another Venue unless they have been granted access to both.
4. THE System SHALL allow an Admin to view a cross-venue summary report listing each Venue's total number of recipes, average Food Cost Percentage, and number of recipes exceeding the target threshold.
5. WHEN an Admin views the cross-venue summary report, THE System SHALL display data only for Venues within the Admin's Organisation.
6. THE System SHALL allow an Admin to copy a recipe from one Venue to another Venue within the same Organisation; the copied recipe SHALL include all ingredient lines and portion data, and SHALL be treated as an independent copy in the destination Venue.
7. IF an ingredient referenced by a recipe being copied does not exist in the destination Venue's Ingredient Library, THEN THE System SHALL display a list of missing ingredients and require the Admin to either map them to existing destination ingredients or create new ones before completing the copy.
8. THE System SHALL allow an Admin to rename or delete a Venue; IF a Venue is deleted, THE System SHALL require explicit confirmation and SHALL permanently delete all ingredients, recipes, and user access records associated with that Venue.
9. THE System SHALL allow a user assigned to multiple Venues to switch between their accessible Venues using a venue selector, and SHALL display only the data belonging to the currently selected Venue.
10. WHEN a user switches to a different Venue, THE System SHALL load that Venue's data within 2 seconds.
11. THE System SHALL display the currently selected Venue name prominently in the application header at all times when a user is authenticated.

---

### Requirement 11: Subscription Tier Management

**User Story:** As an organisation owner, I want to choose and manage a subscription plan, so that I can access the features my business needs and understand what is included in each tier.

#### Acceptance Criteria

1. THE System SHALL assign every new Organisation the Free Tier by default at the time of account creation, with no payment information required.
2. THE System SHALL enforce the following tier limits — Free: maximum 2 Venues per Organisation, maximum 25 recipes per Venue, manual data entry only, no integrations, no AI features; Pro: unlimited Venues, unlimited recipes, Square POS integration, invoice upload; Pro+: all Pro features plus AI insights.
3. WHEN a user on any tier attempts to access a feature not included in their current plan, THE System SHALL display an upgrade prompt identifying the required tier and providing a direct path to upgrade.
4. THE System SHALL allow an Admin to upgrade the Organisation's subscription from Free to Pro, or from Pro to Pro+, or from Free directly to Pro+, by completing a payment flow.
5. THE System SHALL allow an Admin to downgrade the Organisation's subscription; WHEN a downgrade is confirmed, THE System SHALL schedule the downgrade to take effect at the end of the current billing period and notify the Admin of any features or data that will become inaccessible.
6. IF a downgrade would cause the Organisation to exceed a lower tier's limits (e.g., more than 2 Venues on a downgrade to Free), THEN THE System SHALL display a warning listing the excess data and require the Admin to resolve the conflict (by deleting excess Venues or recipes) before the downgrade takes effect.
7. THE System SHALL display the Organisation's current subscription tier and billing renewal date on the account settings page.
8. WHEN a subscription payment fails, THE System SHALL notify the Admin by email and display an in-app banner; IF payment remains unsuccessful after 7 days, THE System SHALL downgrade the Organisation to the Free Tier and restrict access to paid features, preserving all existing data.
9. THE System SHALL allow Admins to view a subscription history showing past tier changes and payment events.

---

### Requirement 12: Pro — Square POS Integration and Invoice Upload

**User Story:** As a Pro subscriber, I want to connect my Square POS and upload supplier invoices, so that ingredient prices are populated automatically without manual entry.

#### Acceptance Criteria

1. WHEN an Organisation is on the Pro or Pro+ Tier, THE System SHALL allow an Admin to connect a Square POS account to a Venue by completing the Square OAuth authorisation flow.
2. WHEN a Square POS account is connected to a Venue, THE System SHALL sync menu item sales data from Square into the System on a schedule no less frequent than once every 24 hours, or on demand when the user triggers a manual sync.
3. WHEN Square sales data is synced, THE System SHALL match Square menu items to recipes in the Venue's Recipe Library by name (case-insensitive exact match) and update each matched recipe's menu selling price with the Square item price.
4. IF a Square menu item cannot be matched to any recipe by name, THE System SHALL log the unmatched item and display it in a review list so the Admin can manually map or dismiss it.
5. THE System SHALL allow an Admin to disconnect the Square integration for a Venue; WHEN disconnected, THE System SHALL stop syncing Square data but SHALL retain all previously synced prices.
6. WHEN an Organisation is on the Pro or Pro+ Tier, THE System SHALL allow users with Admin or Manager roles to upload a supplier invoice as a PDF or image file (JPEG, PNG) of up to 10 MB per file.
7. WHEN an invoice file is uploaded, THE System SHALL extract ingredient names, quantities, units, and prices from the document using OCR or document parsing, and SHALL display the extracted data to the user for review within 30 seconds of upload.
8. WHEN the user confirms the extracted invoice data, THE System SHALL create or update matching ingredients in the Venue's Ingredient Library; IF an extracted ingredient name matches an existing ingredient (case-insensitive), THE System SHALL update that ingredient's purchase price and quantity; IF no match is found, THE System SHALL create a new ingredient entry pre-populated with the extracted data.
9. IF invoice extraction produces low-confidence results for any field (confidence score below the system threshold), THE System SHALL highlight those fields in the review view and require the user to manually confirm or correct them before saving.
10. THE System SHALL retain a history of uploaded invoices per Venue, showing file name, upload date, extracted item count, and processing status, accessible to Admin and Manager roles.

---

### Requirement 13: Pro+ — AI Insights for Recipe and Supplier Cost Management

**User Story:** As a Pro+ subscriber, I want AI-driven insights based on my sales data, so that I can identify opportunities to improve recipe profitability and negotiate better supplier pricing.

#### Acceptance Criteria

1. WHEN an Organisation is on the Pro+ Tier and at least 30 days of Square POS sales data is available for a Venue, THE System SHALL generate AI insights for that Venue and display them in a dedicated Insights dashboard.
2. THE System SHALL generate recipe profitability insights that identify the top 5 highest food-cost recipes relative to their sales volume and suggest specific ingredient substitutions or portion adjustments that would reduce food cost percentage toward the target threshold.
3. THE System SHALL generate supplier cost insights that identify ingredients where the purchase price has increased by more than 10% over the previous 30-day period and recommend reviewing alternative suppliers or renegotiating pricing.
4. WHEN new sales data is synced from Square or new invoice data is confirmed, THE System SHALL refresh the AI insights within 24 hours and display the date and time the insights were last updated.
5. THE System SHALL allow users to mark an insight as "actioned" or "dismissed"; dismissed insights SHALL NOT reappear unless new data produces a materially different recommendation.
6. IF insufficient sales data is available to generate a meaningful insight (fewer than 30 days of data or fewer than 10 sales transactions), THE System SHALL display a message explaining the minimum data requirement and the estimated date when insights will become available.
7. THE System SHALL display each insight with a plain-language explanation of the finding, the supporting data used (e.g., ingredient name, cost change percentage, sales volume), and a recommended action.
8. THE System SHALL NOT make autonomous changes to recipes, ingredients, or prices based on AI insights; all recommendations SHALL require explicit user confirmation before any data is modified.
