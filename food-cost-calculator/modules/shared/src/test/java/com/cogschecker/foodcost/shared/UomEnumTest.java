package com.cogschecker.foodcost.shared;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class UomEnumTest {
    
    @Test
    void testWeightUnitsHaveCorrectDimension() {
        assertEquals(UomEnum.UomDimension.WEIGHT, UomEnum.GRAM.getDimension());
        assertEquals(UomEnum.UomDimension.WEIGHT, UomEnum.KILOGRAM.getDimension());
        assertEquals(UomEnum.UomDimension.WEIGHT, UomEnum.OUNCE.getDimension());
        assertEquals(UomEnum.UomDimension.WEIGHT, UomEnum.POUND.getDimension());
    }
    
    @Test
    void testVolumeUnitsHaveCorrectDimension() {
        assertEquals(UomEnum.UomDimension.VOLUME, UomEnum.MILLILITRE.getDimension());
        assertEquals(UomEnum.UomDimension.VOLUME, UomEnum.LITRE.getDimension());
        assertEquals(UomEnum.UomDimension.VOLUME, UomEnum.TEASPOON.getDimension());
        assertEquals(UomEnum.UomDimension.VOLUME, UomEnum.TABLESPOON.getDimension());
        assertEquals(UomEnum.UomDimension.VOLUME, UomEnum.CUP.getDimension());
    }
    
    @Test
    void testCountUnitHasCorrectDimension() {
        assertEquals(UomEnum.UomDimension.COUNT, UomEnum.EACH.getDimension());
    }
    
    @Test
    void testFromSymbolCaseInsensitive() {
        assertEquals(UomEnum.GRAM, UomEnum.fromSymbol("g"));
        assertEquals(UomEnum.GRAM, UomEnum.fromSymbol("G"));
        assertEquals(UomEnum.KILOGRAM, UomEnum.fromSymbol("kg"));
        assertEquals(UomEnum.KILOGRAM, UomEnum.fromSymbol("KG"));
        assertEquals(UomEnum.KILOGRAM, UomEnum.fromSymbol("Kg"));
        assertEquals(UomEnum.LITRE, UomEnum.fromSymbol("L"));
        assertEquals(UomEnum.LITRE, UomEnum.fromSymbol("l"));
        assertEquals(UomEnum.EACH, UomEnum.fromSymbol("each"));
        assertEquals(UomEnum.EACH, UomEnum.fromSymbol("EACH"));
    }
    
    @Test
    void testFromSymbolThrowsOnUnknownSymbol() {
        assertThrows(IllegalArgumentException.class, () -> UomEnum.fromSymbol("unknown"));
        assertThrows(IllegalArgumentException.class, () -> UomEnum.fromSymbol("grams"));
        assertThrows(IllegalArgumentException.class, () -> UomEnum.fromSymbol(""));
    }
    
    @Test
    void testFromSymbolThrowsOnNull() {
        assertThrows(IllegalArgumentException.class, () -> UomEnum.fromSymbol(null));
    }
    
    @Test
    void testGetSymbol() {
        assertEquals("g", UomEnum.GRAM.getSymbol());
        assertEquals("kg", UomEnum.KILOGRAM.getSymbol());
        assertEquals("ml", UomEnum.MILLILITRE.getSymbol());
        assertEquals("L", UomEnum.LITRE.getSymbol());
        assertEquals("tsp", UomEnum.TEASPOON.getSymbol());
        assertEquals("tbsp", UomEnum.TABLESPOON.getSymbol());
        assertEquals("cup", UomEnum.CUP.getSymbol());
        assertEquals("oz", UomEnum.OUNCE.getSymbol());
        assertEquals("lb", UomEnum.POUND.getSymbol());
        assertEquals("each", UomEnum.EACH.getSymbol());
    }
}
