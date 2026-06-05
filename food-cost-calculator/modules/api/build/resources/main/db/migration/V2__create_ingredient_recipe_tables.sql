-- V2__create_ingredient_recipe_tables.sql
-- Creates tables for ingredients, recipes, and recipe ingredient lines with proper constraints and indexes
-- Requirements: 1.1 (Ingredient Management), 1.10 (Duplicate Name Prevention), 2.1 (Recipe Management)

-- Create ingredients table
CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    purchase_price NUMERIC(10,2) NOT NULL CHECK (purchase_price > 0),
    purchase_quantity NUMERIC(10,4) NOT NULL CHECK (purchase_quantity > 0),
    unit_of_measure VARCHAR(10) NOT NULL CHECK (unit_of_measure IN ('g', 'kg', 'oz', 'lb', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'each')),
    yield_percentage NUMERIC(5,2) NOT NULL DEFAULT 100.00 CHECK (yield_percentage >= 1 AND yield_percentage <= 100),
    cost_per_unit NUMERIC(10,4),
    effective_cost_per_usable_unit NUMERIC(10,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for ingredients
CREATE INDEX idx_ingredients_venue_id ON ingredients(venue_id);

-- Add function-based unique index for case-insensitive ingredient name uniqueness per venue (Requirement 1.10)
CREATE UNIQUE INDEX idx_ingredients_venue_name_unique ON ingredients(venue_id, LOWER(name));

-- Create recipes table
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    portion_count INTEGER NOT NULL CHECK (portion_count >= 1 AND portion_count <= 9999),
    menu_selling_price NUMERIC(10,2) CHECK (menu_selling_price IS NULL OR menu_selling_price > 0),
    total_batch_cost NUMERIC(10,2),
    food_cost_per_portion NUMERIC(10,2),
    food_cost_percentage NUMERIC(5,1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for recipes
CREATE INDEX idx_recipes_venue_id ON recipes(venue_id);

-- Add function-based unique index for case-insensitive recipe name uniqueness per venue (Requirement 1.10)
CREATE UNIQUE INDEX idx_recipes_venue_name_unique ON recipes(venue_id, LOWER(name));

-- Create recipe_ingredient_lines table
CREATE TABLE recipe_ingredient_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
    sub_recipe_id UUID REFERENCES recipes(id) ON DELETE RESTRICT,
    quantity_used NUMERIC(10,4) NOT NULL CHECK (quantity_used > 0),
    unit_of_measure VARCHAR(10) NOT NULL CHECK (unit_of_measure IN ('g', 'kg', 'oz', 'lb', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'each')),
    line_cost NUMERIC(10,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- XOR constraint: exactly one of ingredient_id or sub_recipe_id must be non-null (Requirement 2.1)
    CHECK ((ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR (ingredient_id IS NULL AND sub_recipe_id IS NOT NULL))
);

-- Create indexes for recipe_ingredient_lines
CREATE INDEX idx_recipe_ingredient_lines_recipe_id ON recipe_ingredient_lines(recipe_id);
CREATE INDEX idx_recipe_ingredient_lines_ingredient_id ON recipe_ingredient_lines(ingredient_id);
CREATE INDEX idx_recipe_ingredient_lines_sub_recipe_id ON recipe_ingredient_lines(sub_recipe_id);

-- Create triggers to automatically update updated_at for new tables
CREATE TRIGGER update_ingredients_updated_at BEFORE UPDATE ON ingredients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recipes_updated_at BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recipe_ingredient_lines_updated_at BEFORE UPDATE ON recipe_ingredient_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE ingredients IS 'Ingredient library with pricing, quantities, units of measure, and yield percentages';
COMMENT ON TABLE recipes IS 'Recipe library with portions, costs, and food cost percentages';
COMMENT ON TABLE recipe_ingredient_lines IS 'Ingredient lines within recipes, supporting both ingredients and sub-recipes (mutually exclusive)';
COMMENT ON CONSTRAINT recipe_ingredient_lines_check ON recipe_ingredient_lines IS 'XOR constraint ensuring exactly one of ingredient_id or sub_recipe_id is set';

