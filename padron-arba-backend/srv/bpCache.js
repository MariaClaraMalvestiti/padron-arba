const { Pool } = require("pg");
const processor = require("./padronProcessor");
const { normalizeODataResults, request } = require("./s4Client");
const PRICING_CONFIG = require("./pricingConfig");

let memoryCache = new Map();
let pool = null;
let schemaReady = false;

function normalizeCuit(value) {
    return String(value || "").replace(/\D/g, "");
}

function getPostgresCredentials() {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || "{}");
    const services = Object.values(vcap).flat();
    const postgres = services.find(function (service) {
        return service.label === "postgresql-db" || service.name === "padrones-tax-upload-postgres";
    });

    if (!postgres || !postgres.credentials) {
        return null;
    }

    return postgres.credentials;
}

function getPool() {
    if (pool) return pool;

    const credentials = getPostgresCredentials();
    if (!credentials) return null;

    pool = new Pool({
        host: credentials.hostname,
        port: Number(credentials.port),
        database: credentials.dbname,
        user: credentials.username,
        password: credentials.password,
        ssl: { rejectUnauthorized: false }
    });

    return pool;
}

async function ensureSchema() {
    const db = getPool();
    if (!db || schemaReady) return;

    await db.query(`
        CREATE TABLE IF NOT EXISTS padrones_arba_bp_cache (
            cuit TEXT PRIMARY KEY,
            business_partner TEXT,
            customer_id TEXT,
            nombre TEXT,
            found BOOLEAN DEFAULT FALSE,
            last_refresh_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    schemaReady = true;
}

async function loadFromDb(cuits) {
    const db = getPool();
    if (!db) return new Map();

    await ensureSchema();

    const normalized = Array.from(new Set((cuits || []).map(normalizeCuit).filter(Boolean)));
    if (!normalized.length) return new Map();

    const result = await db.query(
        `SELECT cuit, business_partner, customer_id, nombre, found
         FROM padrones_arba_bp_cache
         WHERE cuit = ANY($1)`,
        [normalized]
    );

    const map = new Map();

    result.rows.forEach(function (row) {
        const value = {
            businessPartner: row.business_partner,
            customerId: row.customer_id,
            nombre: row.nombre,
            found: row.found
        };

        map.set(row.cuit, value);

        if (row.found) {
            memoryCache.set(row.cuit, value);
        }
    });

    return map;
}

async function saveToDb(foundMap, requestedCuits) {
    const db = getPool();
    if (!db) return;

    await ensureSchema();

    const requested = Array.from(new Set((requestedCuits || []).map(normalizeCuit).filter(Boolean)));

    for (const cuit of requested) {
        const cliente = foundMap.get(cuit);

        await db.query(
            `INSERT INTO padrones_arba_bp_cache
                (cuit, business_partner, customer_id, nombre, found, last_refresh_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (cuit) DO UPDATE SET
                business_partner = EXCLUDED.business_partner,
                customer_id = EXCLUDED.customer_id,
                nombre = EXCLUDED.nombre,
                found = EXCLUDED.found,
                last_refresh_at = NOW()`,
            [
                cuit,
                cliente ? cliente.businessPartner : null,
                cliente ? cliente.customerId : null,
                cliente ? cliente.nombre : null,
                !!cliente
            ]
        );
    }
}

async function getStats() {
    const db = getPool();

    if (!db) {
        return {
            ready: memoryCache.size > 0,
            size: memoryCache.size,
            persistent: false,
            lastRefreshAt: null
        };
    }

    await ensureSchema();

    const result = await db.query(`
        SELECT
            COUNT(*)::int AS size,
            MAX(last_refresh_at) AS last_refresh_at
        FROM padrones_arba_bp_cache
        WHERE found = TRUE
    `);

    const row = result.rows[0] || {};

    return {
        ready: Number(row.size || 0) > 0,
        size: Number(row.size || 0),
        persistent: true,
        lastRefreshAt: row.last_refresh_at
    };
}

async function refreshFromCuits(cuits) {
    const uniqueCuits = Array.from(new Set((cuits || []).map(normalizeCuit).filter(Boolean)));

    const cached = await loadFromDb(uniqueCuits);
    const missing = uniqueCuits.filter(function (cuit) {
        return !cached.has(cuit);
    });

    if (missing.length) {
        const foundFromS4 = await processor.findBusinessPartnersByCuits(missing);
        await saveToDb(foundFromS4, missing);

        foundFromS4.forEach(function (cliente, cuit) {
            memoryCache.set(normalizeCuit(cuit), cliente);
        });
    }

    return getStats();
}

async function resolve(cuits) {
    const uniqueCuits = Array.from(new Set((cuits || []).map(normalizeCuit).filter(Boolean)));
    const cached = await loadFromDb(uniqueCuits);
    const found = [];

    uniqueCuits.forEach(function (cuit) {
        const cliente = memoryCache.get(cuit) || cached.get(cuit);

        if (cliente && cliente.found !== false && cliente.customerId) {
            found.push({
                cuit,
                businessPartner: cliente.businessPartner,
                customerId: cliente.customerId,
                nombre: cliente.nombre
            });
        }
    });

    return {
        requested: uniqueCuits.length,
        found: found.length,
        businessPartners: found,
        cache: await getStats()
    };
}

async function clearDbCache() {
    const db = getPool();

    if (!db) {
        memoryCache = new Map();
        return;
    }

    await ensureSchema();
    await db.query("TRUNCATE TABLE padrones_arba_bp_cache");
}

function getNextPathFromOData(data) {
    const next = data && data.d && data.d.__next;

    if (!next) {
        return "";
    }

    return next.replace(/^https?:\/\/[^/]+/, "");
}

async function upsertMany(items) {
    const db = getPool();

    const uniqueByCuit = new Map();
    items.forEach(function (item) {
        const cuit = normalizeCuit(item.cuit);
        if (cuit) {
            uniqueByCuit.set(cuit, Object.assign({}, item, { cuit: cuit }));
        }
    });

    items = Array.from(uniqueByCuit.values());

    items.forEach(function (item) {
        memoryCache.set(normalizeCuit(item.cuit), item);
    });

    if (!db || !items.length) {
        return;
    }

    await ensureSchema();

    const values = [];
    const placeholders = items.map(function (item, index) {
        const base = index * 5;
        values.push(
            normalizeCuit(item.cuit),
            item.businessPartner || "",
            item.customerId || "",
            item.nombre || "",
            true
        );

        return "($" + (base + 1) + ", $" + (base + 2) + ", $" + (base + 3) + ", $" + (base + 4) + ", $" + (base + 5) + ", NOW())";
    });

    await db.query(
        "INSERT INTO padrones_arba_bp_cache (cuit, business_partner, customer_id, nombre, found, last_refresh_at) VALUES " +
        placeholders.join(",") +
        " ON CONFLICT (cuit) DO UPDATE SET business_partner = EXCLUDED.business_partner, customer_id = EXCLUDED.customer_id, nombre = EXCLUDED.nombre, found = TRUE, last_refresh_at = NOW()",
        values
    );
}

async function rebuildAllFromS4(onProgress) {
    await clearDbCache();

    const taxByBp = new Map();
    let taxPath = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber?$select=BusinessPartner,BPTaxNumber,BPTaxLongNumber&$format=json";
    let taxCount = 0;

    while (taxPath) {
        const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
            url: taxPath
        });

        const rows = normalizeODataResults(data);

        rows.forEach(function (row) {
            [row.BPTaxNumber, row.BPTaxLongNumber].forEach(function (value) {
                const cuit = normalizeCuit(value);

                if (cuit.length === 11 && row.BusinessPartner) {
                    if (!taxByBp.has(row.BusinessPartner)) {
                        taxByBp.set(row.BusinessPartner, []);
                    }

                    taxByBp.get(row.BusinessPartner).push(cuit);
                    taxCount += 1;
                }
            });
        });

        if (onProgress) {
            await onProgress("Leyendo CUITs BP desde S/4: " + taxCount);
        }

        taxPath = getNextPathFromOData(data);
    }

    let bpPath = "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$select=BusinessPartner,Customer,BusinessPartnerFullName,OrganizationBPName1,SearchTerm1&$format=json";
    let saved = 0;

    while (bpPath) {
        const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
            url: bpPath
        });

        const rows = normalizeODataResults(data);
        const items = [];

        rows.forEach(function (bp) {
            const customerId = bp.Customer;

            if (!bp.BusinessPartner || !customerId) {
                return;
            }

            const cuits = taxByBp.get(bp.BusinessPartner) || [];
            const nombre = bp.BusinessPartnerFullName || bp.OrganizationBPName1 || bp.SearchTerm1 || customerId;

            cuits.forEach(function (cuit) {
                items.push({
                    cuit: cuit,
                    businessPartner: bp.BusinessPartner,
                    customerId: customerId,
                    nombre: nombre
                });
            });
        });

        await upsertMany(items);
        saved += items.length;

        if (onProgress) {
            await onProgress("Guardando cache BP local: " + saved);
        }

        bpPath = getNextPathFromOData(data);
    }

    return getStats();
}

module.exports = {
    getStats,
    refreshFromCuits,
    resolve,
    rebuildAllFromS4
};
