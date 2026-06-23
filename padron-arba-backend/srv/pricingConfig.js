const PRICING_CONFIG = {
    destinationName: process.env.PRICING_DESTINATION || "S4HANA-PRICING",
    businessPartnerDestinationName: process.env.BP_DESTINATION || "S4HANA-BP",
    conditionTable: process.env.PRICING_CONDITION_TABLE || "901",
    conditionType: process.env.PRICING_CONDITION_TYPE || "Z902",
    accessSequence: process.env.PRICING_ACCESS_SEQUENCE || "Z901",
    country: process.env.PRICING_COUNTRY || "AR",
    rateUnit: process.env.PRICING_RATE_UNIT || "%",
    taxCode: process.env.PRICING_TAX_CODE || "SD",
    currency: process.env.PRICING_CURRENCY || "ARS"
};

module.exports = PRICING_CONFIG;
