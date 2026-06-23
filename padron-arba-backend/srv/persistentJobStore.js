const { Pool } = require("pg");
const crypto = require("crypto");

let pool = null;
let schemaReady = false;
const memoryJobs = new Map();

function getBoundService(label, fallbackName) {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || "{}");
    const services = Object.values(vcap).flat();

    return services.find(function (service) {
        return service.label === label || service.name === fallbackName;
    });
}

function getPostgresCredentials() {
    const service = getBoundService("postgresql-db", "padrones-tax-upload-postgres");
    return service && service.credentials;
}

function hasPostgres() {
    return !!getPostgresCredentials();
}

function getPool() {
    if (pool) return pool;

    const credentials = getPostgresCredentials();

    if (!credentials) {
        return null;
    }

    pool = new Pool({
        host: credentials.hostname,
        port: Number(credentials.port),
        database: credentials.dbname,
        user: credentials.username,
        password: credentials.password,
        ssl: {
            rejectUnauthorized: false
        }
    });

    return pool;
}

async function ensureSchema() {
    const db = getPool();

    if (!db || schemaReady) {
        return;
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS padrones_arba_jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            total_records INTEGER DEFAULT 0,
            found_records INTEGER DEFAULT 0,
            not_found_records INTEGER DEFAULT 0,
            create_records INTEGER DEFAULT 0,
            update_records INTEGER DEFAULT 0,
            error_records INTEGER DEFAULT 0,
            message TEXT,
            error TEXT,
            result_json TEXT
        )
    `);

    schemaReady = true;
}

function nowIso() {
    return new Date().toISOString();
}

function sanitizeResult(result) {
    if (!result) return result;

    const registros = Array.isArray(result.registros) ? result.registros : [];
    const registrosAplicables = registros.filter(function (registro) {
        return registro.estado === "Crear" ||
            registro.estado === "Modificar" ||
            registro.estado === "Creado" ||
            registro.estado === "Actualizado";
    });

    return Object.assign({}, result, {
        registros: registrosAplicables
    });
}

function buildJob(row) {
    if (!row) return null;

    return {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        error: row.error,
        result: row.result_json ? sanitizeResult(JSON.parse(row.result_json)) : null,
        summary: {
            totalRegistros: row.total_records || 0,
            encontrados: row.found_records || 0,
            noEncontrados: row.not_found_records || 0,
            crear: row.create_records || 0,
            modificar: row.update_records || 0,
            errores: row.error_records || 0
        }
    };
}

async function createJob() {
    const id = "JOB-" + Date.now() + "-" + crypto.randomInt(1000, 9999);
    const job = {
        id,
        status: "PENDING",
        createdAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        error: null,
        result: null
    };

    const db = getPool();

    if (!db) {
        memoryJobs.set(id, job);
        return job;
    }

    await ensureSchema();

    await db.query(
        `INSERT INTO padrones_arba_jobs (id, status, created_at, message)
         VALUES ($1, $2, $3, $4)`,
        [id, job.status, job.createdAt, "Job creado."]
    );

    return job;
}

function getSummary(result) {
    result = result || {};
    return {
        totalRegistros: Number(result.totalRegistros || 0),
        encontrados: Number(result.encontrados || 0),
        noEncontrados: Number(result.noEncontrados || 0),
        crear: Number(result.crear || 0),
        modificar: Number(result.modificar || 0),
        errores: Number(result.errores || 0)
    };
}

async function updateJob(id, patch) {
    const db = getPool();

    if (!db) {
        const current = memoryJobs.get(id);
        if (!current) return null;
        const next = Object.assign({}, current, patch);
        memoryJobs.set(id, next);
        return next;
    }

    await ensureSchema();

    const result = patch.result;
    const summary = getSummary(result);

    await db.query(
        `UPDATE padrones_arba_jobs
         SET status = COALESCE($2, status),
             started_at = COALESCE($3, started_at),
             finished_at = COALESCE($4, finished_at),
             error = COALESCE($5, error),
             result_json = COALESCE($6, result_json),
             total_records = COALESCE($7, total_records),
             found_records = COALESCE($8, found_records),
             not_found_records = COALESCE($9, not_found_records),
             create_records = COALESCE($10, create_records),
             update_records = COALESCE($11, update_records),
             error_records = COALESCE($12, error_records),
             message = COALESCE($13, message)
         WHERE id = $1`,
        [
            id,
            patch.status || null,
            patch.startedAt || null,
            patch.finishedAt || null,
            patch.error || null,
            result ? JSON.stringify(sanitizeResult(result)) : null,
            result ? summary.totalRegistros : null,
            result ? summary.encontrados : null,
            result ? summary.noEncontrados : null,
            result ? summary.crear : null,
            result ? summary.modificar : null,
            result ? summary.errores : null,
            patch.message || null
        ]
    );

    return getJob(id);
}

async function getJob(id) {
    const db = getPool();

    if (!db) {
        return memoryJobs.get(id) || null;
    }

    await ensureSchema();

    const result = await db.query(
        `SELECT * FROM padrones_arba_jobs WHERE id = $1`,
        [id]
    );

    return buildJob(result.rows[0]);
}

async function listJobs() {
    const db = getPool();

    if (!db) {
        return Array.from(memoryJobs.values());
    }

    await ensureSchema();

    const result = await db.query(
        `SELECT * FROM padrones_arba_jobs ORDER BY created_at DESC LIMIT 20`
    );

    return result.rows.map(buildJob);
}

module.exports = {
    hasPostgres,
    ensureSchema,
    createJob,
    updateJob,
    getJob,
    listJobs
};
