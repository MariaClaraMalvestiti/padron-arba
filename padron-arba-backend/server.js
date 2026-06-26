const fs = require("fs"); const path = require("path"); const envPath = path.join(__dirname, "..", "default-env.json"); if (!process.env.VCAP_SERVICES && fs.existsSync(envPath)) { const env = JSON.parse(fs.readFileSync(envPath, "utf8")); Object.keys(env).forEach((key) => { process.env[key] = typeof env[key] === "string" ? env[key] : JSON.stringify(env[key]); }); }
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const readline = require("readline");
const crypto = require("crypto");
const PRICING_CONFIG = require("./srv/pricingConfig");
const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { request } = require("./srv/s4Client");
const processor = require("./srv/padronProcessor");
const jobStore = require("./srv/persistentJobStore");
const bpCache = require("./srv/bpCache");

const app = express();
const port = process.env.PORT || 4004;
const upload = multer({
    dest: process.env.PADRON_UPLOAD_DIR || "/tmp",
    limits: {
        fileSize: 400 * 1024 * 1024
    }
});

function readFirstLines(filePath, maxLines) {
    return new Promise(function (resolve, reject) {
        const stream = fs.createReadStream(filePath, {
            encoding: "latin1",
            highWaterMark: 1024 * 1024
        });

        let content = "";
        let lineCount = 0;
        let done = false;

        stream.on("data", function (chunk) {
            if (done) return;

            content += chunk;

            const lines = content.split(/\r?\n/);

            if (lines.length > maxLines) {
                content = lines.slice(0, maxLines).join("\n");
                done = true;
                stream.destroy();
                resolve(content);
                return;
            }

            lineCount = lines.length;
        });

        stream.on("end", function () {
            if (!done) {
                resolve(content);
            }
        });

        stream.on("error", function (error) {
            if (!done) {
                reject(error);
            }
        });
    });
}

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
}));
app.use(express.json({ limit: "100mb" }));
app.use(express.text({ type: "text/*", limit: "100mb" }));

app.get("/api/destinations/check", async (_req, res, next) => {
    try {
        const bp = await getDestination({ destinationName: PRICING_CONFIG.businessPartnerDestinationName });
        const pricing = await getDestination({ destinationName: PRICING_CONFIG.destinationName });

        res.json({
            businessPartnerDestination: {
                name: PRICING_CONFIG.businessPartnerDestinationName,
                found: !!bp,
                url: bp && bp.url,
                authentication: bp && bp.authentication,
                proxyType: bp && bp.proxyType
            },
            pricingDestination: {
                name: PRICING_CONFIG.destinationName,
                found: !!pricing,
                url: pricing && pricing.url,
                authentication: pricing && pricing.authentication,
                proxyType: pricing && pricing.proxyType
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/business-partners/sample-tax-numbers", async (_req, res, next) => {
    try {
        const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
            url: "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber",
            params: {
                "$top": "10",
                "$select": "BusinessPartner,BPTaxNumber,BPTaxType",
                "$format": "json"
            }
        });

        res.json(data);
    } catch (error) {
        next(error);
    }
});

app.post("/api/business-partners/resolve", async (req, res, next) => {
    try {
        const cuits = req.body && Array.isArray(req.body.cuits) ? req.body.cuits : [];

        if (!cuits.length) {
            res.status(400).json({
                error: "Debe enviarse un array cuits."
            });
            return;
        }

        const uniqueCuits = Array.from(new Set(cuits.map(String).filter(Boolean)));
        const clientesPorCuit = await processor.findBusinessPartnersByCuits(uniqueCuits);

        const found = [];
        clientesPorCuit.forEach(function (cliente, cuit) {
            found.push(Object.assign({ cuit: cuit }, cliente));
        });

        res.json({
            requested: uniqueCuits.length,
            found: found.length,
            businessPartners: found
        });
    } catch (error) {
        next(error);
    }
});


app.post("/api/business-partners/cache/rebuild-job", async (_req, res, next) => {
    try {
        const job = await Promise.resolve(jobStore.createJob({
            content: "",
            cuits: [],
            maxRecords: 0
        }));

        setTimeout(async function () {
            try {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "RUNNING",
                    startedAt: new Date().toISOString(),
                    message: "Reconstruyendo cache completa de Business Partner desde S/4..."
                }));

                const stats = await bpCache.rebuildAllFromS4(async function (message) {
                    await Promise.resolve(jobStore.updateJob(job.id, {
                        message: message
                    }));
                });

                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "DONE",
                    finishedAt: new Date().toISOString(),
                    result: {
                        totalRegistros: stats.size || 0,
                        encontrados: stats.size || 0,
                        noEncontrados: 0,
                        crear: 0,
                        modificar: 0,
                        errores: 0,
                        registros: []
                    },
                    message: "Cache BP reconstruida. Clientes cacheados: " + (stats.size || 0)
                }));
            } catch (error) {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "ERROR",
                    finishedAt: new Date().toISOString(),
                    error: error.message
                }));
            }
        }, 0);

        res.status(202).json({
            jobId: job.id,
            status: job.status || "PENDING"
        });
    } catch (error) {
        next(error);
    }
});


app.get("/api/business-partners/cache/status", async (_req, res, next) => {
    try {
        res.json(await bpCache.getStats());
    } catch (error) {
        next(error);
    }
});

app.post("/api/business-partners/cache/refresh", async (req, res, next) => {
    try {
        const cuits = req.body && Array.isArray(req.body.cuits) ? req.body.cuits : [];

        if (!cuits.length) {
            res.status(400).json({ error: "Debe enviarse un array cuits." });
            return;
        }

        const stats = await bpCache.refreshFromCuits(cuits);
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

app.post("/api/business-partners/resolve-cached", async (req, res, next) => {
   try {
        const cuits = req.body && Array.isArray(req.body.cuits) ? req.body.cuits : [];
        res.json(await bpCache.resolve(cuits));
    } catch (error) {
        next(error);
    }
});

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        pricing: PRICING_CONFIG
    });
});


app.post("/api/padron/apply-job", async (req, res, next) => {
    try {
        let rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : [];
        const sourceJobId = req.body && req.body.jobId ? String(req.body.jobId) : "";

        if (!rows.length && sourceJobId) {
            const sourceJob = await Promise.resolve(jobStore.getJob(sourceJobId));
            rows = sourceJob && sourceJob.result && Array.isArray(sourceJob.result.registros)
                ? sourceJob.result.registros
                : [];
        }

        if (!rows.length) {
            res.status(400).json({
                error: "No hay clientes filtrados para aplicar. Primero procesá el padrón."
            });
            return;
        }

        const job = await Promise.resolve(jobStore.createJob({
            content: "",
            cuits: [],
            maxRecords: rows.length
        }));

        setTimeout(async function () {
            const result = {
                totalRegistros: rows.length,
                encontrados: 0,
                noEncontrados: 0,
                crear: 0,
                modificar: 0,
                errores: 0,
                registros: [],
                aplicados: 0
            };

            function buildPadronLine(row) {
                return [
                    "P",
                    row.publicationDate || "",
                    row.fechaDesde,
                    row.fechaHasta,
                    row.cuit,
                    row.tipoContribuyente || "",
                    row.altaBaja || "N",
                    row.cambioAlicuota || "S",
                    String(row.alicuota || 0).replace(".", ","),
                    row.grupo || ""
                ].join(";") + "\n";
            }

            function addPartial(partial) {
                result.encontrados += partial.encontrados || 0;
                result.noEncontrados += partial.noEncontrados || 0;
                result.crear += partial.crear || 0;
                result.modificar += partial.modificar || 0;
                result.errores += partial.errores || 0;
                result.aplicados += partial.aplicados || 0;

                if (Array.isArray(partial.registros)) {
                    result.registros = result.registros.concat(partial.registros);
                }
            }

            try {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "RUNNING",
                    startedAt: new Date().toISOString(),
                    result: result,
                    message: "Aplicando cambios: 0/" + rows.length
                }));

                for (let index = 0; index < rows.length; index += 1) {
                    const row = rows[index];

                    try {
                        const partial = await processor.applyPadron(buildPadronLine(row), {
                            maxRecords: 1
                        });

                        addPartial(partial);
                    } catch (rowError) {
                        result.errores += 1;
                        result.registros.push(Object.assign({}, row, {
                            estado: "Error aplicacion",
                            estadoColor: "Error",
                            estadoIcono: "sap-icon://error",
                            accion: "No se pudo aplicar el cambio en S/4",
                            detalle: rowError.message
                        }));
                    }

                    if ((index + 1) % 5 === 0 || index + 1 === rows.length) {
                        await Promise.resolve(jobStore.updateJob(job.id, {
                            status: "RUNNING",
                            result: result,
                            message: "Aplicando cambios: " + (index + 1) + "/" + rows.length +
                                ". Aplicados: " + (result.aplicados || 0) +
                                ". Errores: " + (result.errores || 0) + "."
                        }));
                    }
                }

                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "DONE",
                    finishedAt: new Date().toISOString(),
                    result: result,
                    message: "Aplicacion finalizada. Aplicados en S/4: " + (result.aplicados || 0) + ". Errores: " + (result.errores || 0) + "."
                }));
            } catch (error) {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "ERROR",
                    finishedAt: new Date().toISOString(),
                    result: result,
                    error: error.message
                }));
            }
        }, 0);

        res.status(202).json({
            jobId: job.id,
            status: job.status || "PENDING"
        });
    } catch (error) {
        next(error);
    }
});


app.post("/api/padron/apply-rows", async (req, res, next) => {
    try {
        const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : [];

        if (!rows.length) {
            res.status(400).json({
                error: "Debe enviarse rows con al menos un registro filtrado."
            });
            return;
        }

        const content = rows.map(function (row) {
            return [
                "P",
                row.publicationDate || "29042026",
                row.fechaDesde || row.validFrom,
                row.fechaHasta || row.validTo,
                row.cuit,
                row.tipoContribuyente || "D",
                row.altaBaja || "S",
                row.cambioAlicuota || "S",
                String(row.alicuota || row.rate || "0").replace(".", ","),
                row.grupo || "01",
                ""
            ].join(";");
        }).join("\n");

        const result = await processor.applyPadron(content, {
            maxRecords: rows.length
        });

        res.json({
            totalRows: rows.length,
            result
        });
    } catch (error) {
        next(error);
    }
});


function parsePadronLineForFilter(line) {
    const fields = String(line || "").trim().split(";").map(function (field) {
        return field.trim();
    });

    if (fields.length < 9 || fields[0] !== "P") {
        return null;
    }

    return {
        cuit: String(fields[4] || "").replace(/\D/g, ""),
        fechaDesde: fields[2],
        fechaHasta: fields[3],
        alicuota: Number(String(fields[8] || "0").replace(",", ".")) || 0,
        altaBaja: fields[6],
        cambioAlicuota: fields[7]
    };
}

async function readPadronUniqueRows(filePath, jobId) {
    const rowsByCuit = new Map();
    let totalLines = 0;

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: "latin1" }),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const row = parsePadronLineForFilter(line);

        if (!row || !row.cuit) {
            continue;
        }

        totalLines += 1;

        if (!rowsByCuit.has(row.cuit)) {
            rowsByCuit.set(row.cuit, row);
        }

        if (totalLines % 50000 === 0) {
            await Promise.resolve(jobStore.updateJob(jobId, {
                message: "Leyendo padrón. Registros detectados: " + totalLines + ". CUITs únicos: " + rowsByCuit.size
            }));
        }
    }

    return {
        totalLines: totalLines,
        rowsByCuit: rowsByCuit
    };
}


function sanitizeUploadId(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function getChunkUploadPath(uploadId) {
    return path.join(process.env.PADRON_UPLOAD_DIR || "/tmp", "padron-upload-" + uploadId + ".txt");
}


async function filterUploadedPadronStreaming(filePath, jobId) {
    const foundRows = [];
    const batchSize = 5000;
    let totalRegistros = 0;
    let batchRows = [];

    async function processBatch() {
        if (!batchRows.length) {
            return;
        }

        const cuits = Array.from(new Set(batchRows.map(function (row) {
            return row.cuit;
        })));

     const resolved = await bpCache.resolve(cuits);
        const bpByCuit = new Map();

        (resolved.businessPartners || []).forEach(function (bp) {
            bpByCuit.set(String(bp.cuit), bp);
        });


        for (const row of batchRows) {
            const bp = bpByCuit.get(row.cuit);

            if (!bp) {
                continue;
            }

            foundRows.push(Object.assign({}, row, {
                businessPartner: bp.businessPartner,
                customerId: bp.customerId,
                nombre: bp.nombre,
                categoriaFiscal: "IB2",
                estado: "Crear",
                estadoColor: "Information",
                estadoIcono: "sap-icon://add-document",
                accion: "Listo para aplicar en S/4"
            }));
        }

        await Promise.resolve(jobStore.updateJob(jobId, {
            message: "Filtrando padrón por stream. Registros: " + totalRegistros + ". Encontrados: " + foundRows.length
        }));

        batchRows = [];
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: "latin1" }),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const row = parsePadronLineForFilter(line);

        if (!row || !row.cuit) {
            continue;
        }

        totalRegistros += 1;

        if (totalRegistros % 100000 === 0) {
            await Promise.resolve(jobStore.updateJob(jobId, {
                message: "Leyendo padrón por stream. Registros leídos: " + totalRegistros + ". Encontrados: " + foundRows.length,
                summary: {
                    totalRegistros: totalRegistros,
                    encontrados: foundRows.length,
                    noEncontrados: Math.max(totalRegistros - foundRows.length, 0),
                    crear: foundRows.length,
                    modificar: 0,
                    errores: 0
                }
            }));
        }

        batchRows.push(row);

        if (batchRows.length >= batchSize) {
            await processBatch();
        }
    }

    await processBatch();

    return {
        totalRegistros: totalRegistros,
        encontrados: foundRows.length,
        noEncontrados: Math.max(totalRegistros - foundRows.length, 0),
        crear: foundRows.length,
        modificar: 0,
        bajas: foundRows.filter(function (row) { return row.altaBaja === "B"; }).length,
        errores: 0,
        registros: foundRows
    };
}


app.post("/api/padron/upload-chunk", upload.single("chunk"), async (req, res, next) => {
    try {
        const uploadId = sanitizeUploadId(req.body.uploadId || crypto.randomUUID());
        const fileName = req.body.fileName || "padron.txt";
        const chunkIndex = Number(req.body.chunkIndex || 0);
        const totalChunks = Number(req.body.totalChunks || 1);

        if (!req.file) {
            res.status(400).json({ error: "Debe enviarse el chunk en el campo chunk." });
            return;
        }

        if (!Number.isFinite(chunkIndex) || !Number.isFinite(totalChunks) || totalChunks <= 0) {
            res.status(400).json({ error: "chunkIndex/totalChunks invalidos." });
            return;
        }

        const targetPath = getChunkUploadPath(uploadId);

        if (chunkIndex === 0 && fs.existsSync(targetPath)) {
            await fs.promises.unlink(targetPath);
        }

        await fs.promises.appendFile(targetPath, await fs.promises.readFile(req.file.path));
        await fs.promises.unlink(req.file.path).catch(function () {});

        if (chunkIndex + 1 < totalChunks) {
            res.json({
                uploadId: uploadId,
                received: chunkIndex + 1,
                totalChunks: totalChunks
            });
            return;
        }

        const job = await Promise.resolve(jobStore.createJob({
            content: "",
            cuits: [],
            maxRecords: 0
        }));

        setTimeout(async function () {
            try {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "RUNNING",
                    startedAt: new Date().toISOString(),
                    message: "Procesando archivo subido por chunks: " + fileName
                }));

                const result = await filterUploadedPadronStreaming(targetPath, job.id);

                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "DONE",
                    finishedAt: new Date().toISOString(),
                    result: result,
                    message: "Filtrado finalizado. Encontrados: " + result.encontrados + ". No encontrados: " + result.noEncontrados + "."
                }));
            } catch (error) {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "ERROR",
                    finishedAt: new Date().toISOString(),
                    error: error.message
                }));
            } finally {
                fs.promises.unlink(targetPath).catch(function () {});
            }
        }, 0);

        res.status(202).json({
            uploadId: uploadId,
            received: totalChunks,
            totalChunks: totalChunks,
            jobId: job.id,
            status: job.status || "PENDING"
        });
    } catch (error) {
        next(error);
    }
});


app.post("/api/padron/filter-jobs", upload.single("file"), async (req, res, next) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: "Debe enviarse un archivo en el campo file." });
            return;
        }

        const filePath = req.file.path;
        const fileName = req.file.originalname;

        const job = await Promise.resolve(jobStore.createJob({
            content: "",
            cuits: [],
            maxRecords: 0
        }));

        setTimeout(async function () {
            try {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "RUNNING",
                    startedAt: new Date().toISOString(),
                    message: "Leyendo archivo " + fileName
                }));

                const readResult = await readPadronUniqueRows(filePath, job.id);
                const cuits = Array.from(readResult.rowsByCuit.keys());
                const batchSize = 200;
                const foundRows = [];
                const bpCsrfToken = await processor.fetchBusinessPartnerCsrfToken();

                for (let index = 0; index < cuits.length; index += batchSize) {
                    const batch = cuits.slice(index, index + batchSize);

                    const resolved = await bpCache.resolve(batch);
                    const bpByCuit = new Map();

                    (resolved.businessPartners || []).forEach(function (bp) {
                        bpByCuit.set(String(bp.cuit), bp);
                    });

                    for (const cuit of batch) {
                        const bp = bpByCuit.get(cuit);
                        const row = readResult.rowsByCuit.get(cuit);

                        if (!bp || !row) {
                            continue;
                        }

                        try {
                            const ib2Status = await processor.ensureCustomerTaxGroupingIB2(bp.customerId, row, bpCsrfToken);

                            foundRows.push(Object.assign({}, row, {
                                businessPartner: bp.businessPartner,
                                customerId: bp.customerId,
                                nombre: bp.nombre,
                                categoriaFiscal: "IB2",
                                categoriaFiscalEstado: ib2Status,
                                estado: "Crear",
                                estadoColor: "Information",
                                estadoIcono: "sap-icon://add-document",
                                accion: "Listo para aplicar en S/4"
                            }));
                        } catch (error) {
                            foundRows.push(Object.assign({}, row, {
                                businessPartner: bp.businessPartner,
                                customerId: bp.customerId,
                                nombre: bp.nombre,
                                categoriaFiscal: "IB2",
                                estado: "Error categoria fiscal",
                                estadoColor: "Error",
                                estadoIcono: "sap-icon://error",
                                accion: "No se pudo actualizar categoria fiscal IB2",
                                detalle: error.message
                            }));
                        }
                    }

                    await Promise.resolve(jobStore.updateJob(job.id, {
                        message: "Filtrando Business Partners: " + Math.min(index + batch.length, cuits.length) + "/" + cuits.length
                    }));
                }

                const result = {
                    totalRegistros: cuits.length,
                    encontrados: foundRows.length,
                    noEncontrados: Math.max(cuits.length - foundRows.length, 0),
                    crear: foundRows.length,
                    modificar: 0,
                    bajas: foundRows.filter(function (row) { return row.altaBaja === "B"; }).length,
                    errores: 0,
                    registros: foundRows
                };

                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "DONE",
                    finishedAt: new Date().toISOString(),
                    result: result,
                    message: "Filtrado finalizado. Encontrados: " + result.encontrados + ". No encontrados: " + result.noEncontrados + "."
                }));
            } catch (error) {
                await Promise.resolve(jobStore.updateJob(job.id, {
                    status: "ERROR",
                    finishedAt: new Date().toISOString(),
                    error: error.message
                }));
            } finally {
                fs.promises.unlink(filePath).catch(function () {});
            }
        }, 0);

        res.status(202).json({
            jobId: job.id,
            status: job.status || "PENDING"
        });
    } catch (error) {
        next(error);
    }
});


app.post("/api/padron/apply-file", upload.single("file"), async (req, res, next) => {
    const filePath = req.file && req.file.path;
    const originalName = req.file && req.file.originalname;

    if (!filePath) {
        res.status(400).json({
            error: "Debe enviarse el archivo TXT en el campo file."
        });
        return;
    }

    const maxRecords = req.query && req.query.maxRecords ? Number(req.query.maxRecords) : 1;

    try {
        const content = await readFirstLines(filePath, maxRecords);
        const result = await processor.applyPadron(content, { maxRecords });

        res.json({
            fileName: originalName,
            result
        });
    } catch (error) {
        next(error);
    } finally {
        fs.promises.unlink(filePath).catch(function () {});
    }
});

app.post("/api/padron/jobs-upload", upload.single("file"), async (req, res, next) => {
    try {
        if (!req.file) {
            res.status(400).json({
                error: "Debe enviarse un archivo en el campo file."
            });
            return;
        }

        const filePath = req.file.path;
        const originalName = req.file.originalname;

        const job = await jobStore.createJob();

        setTimeout(async function () {
            await jobStore.updateJob(job.id, {
                status: "RUNNING",
                startedAt: new Date().toISOString(),
                message: "Procesando archivo " + originalName
            });

            try {
                const result = await filterUploadedPadronStreaming(filePath, job.id);

                await jobStore.updateJob(job.id, {
                    status: "DONE",
                    finishedAt: new Date().toISOString(),
                    result
                });
            } catch (error) {
                await jobStore.updateJob(job.id, {
                    status: "ERROR",
                    finishedAt: new Date().toISOString(),
                    error: error.message
                });
            } finally {
                fs.promises.unlink(filePath).catch(function () {});
            }
        }, 0);

        res.status(202).json({
            jobId: job.id,
            status: job.status
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/padron/jobs-file", async (req, res, next) => {
    const content = typeof req.body === "string" ? req.body : "";

    if (!content) {
        res.status(400).json({
            error: "Debe enviarse el contenido TXT como text/plain."
        });
        return;
    }

    const maxRecords = req.query && req.query.maxRecords ? Number(req.query.maxRecords) : 250;

    const job = await jobStore.createJob();

    setTimeout(async function () {
        await jobStore.updateJob(job.id, {
            status: "RUNNING",
            startedAt: new Date().toISOString()
        });

        try {
            const result = await processor.previewPadron(content, {
                cuits: [],
                maxRecords
            });

            await jobStore.updateJob(job.id, {
                status: "DONE",
                finishedAt: new Date().toISOString(),
                result
            });
        } catch (error) {
            await jobStore.updateJob(job.id, {
                status: "ERROR",
                finishedAt: new Date().toISOString(),
                error: error.message
            });
        }
    }, 0);

    res.status(202).json({
        jobId: job.id,
        status: job.status
    });
});

app.post("/api/padron/jobs", async (req, res, next) => {
    const content = typeof req.body === "string" ? req.body : req.body && req.body.content;

    if (!content) {
        res.status(400).json({
            error: "Debe enviarse el contenido TXT en el body o en la propiedad content."
        });
        return;
    }

    const cuits = req.body && Array.isArray(req.body.cuits) ? req.body.cuits : [];
    const maxRecords = req.body && req.body.maxRecords ? Number(req.body.maxRecords) : 250;

    const job = await jobStore.createJob();

    setTimeout(async function () {
        await jobStore.updateJob(job.id, {
            status: "RUNNING",
            startedAt: new Date().toISOString()
        });

        try {
            const result = await processor.previewPadron(content, {
                cuits,
                maxRecords
            });

            await jobStore.updateJob(job.id, {
                status: "DONE",
                finishedAt: new Date().toISOString(),
                result
            });
        } catch (error) {
            await jobStore.updateJob(job.id, {
                status: "ERROR",
                finishedAt: new Date().toISOString(),
                error: error.message
            });
        }
    }, 0);

    res.status(202).json({
        jobId: job.id,
        status: job.status
    });
});

app.get("/api/padron/jobs", async (_req, res, next) => {
    const jobs = await jobStore.listJobs();

    res.json({
        jobs: jobs.map(function (job) {
            return {
                id: job.id,
                status: job.status,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                finishedAt: job.finishedAt,
                error: job.error,
                summary: job.result ? {
                    totalRegistros: job.result.totalRegistros,
                    encontrados: job.result.encontrados,
                    noEncontrados: job.result.noEncontrados,
                    crear: job.result.crear,
                    modificar: job.result.modificar,
                    errores: job.result.errores
                } : null
            };
        })
    });
});

app.get("/api/padron/jobs/:jobId", async (req, res, next) => {
    const job = await jobStore.getJob(req.params.jobId);

    if (!job) {
        res.status(404).json({
            error: "Job no encontrado."
        });
        return;
    }

    res.json(job);
});

app.post("/api/padron/preview", async (req, res, next) => {
    try {
        const content = typeof req.body === "string" ? req.body : req.body && req.body.content;

        if (!content) {
            res.status(400).json({
                error: "Debe enviarse el contenido TXT en el body o en la propiedad content."
            });
            return;
        }

        const maxRecords = req.body && req.body.maxRecords ? Number(req.body.maxRecords) : 250;

        res.json(await processor.previewPadron(content, { maxRecords }));
    } catch (error) {
        next(error);
    }
});

app.post("/api/padron/parse", (req, res) => {
    const content = typeof req.body === "string" ? req.body : req.body && req.body.content;

    if (!content) {
        res.status(400).json({
            error: "Debe enviarse el contenido TXT en el body o en la propiedad content."
        });
        return;
    }

    res.json({
        registros: processor.parsePadron(content)
    });
});

app.get("/api/business-partners/:cuit", async (req, res, next) => {
    try {
        const result = await processor.findBusinessPartnerByCuit(req.params.cuit);

        if (!result) {
            res.status(404).json({
                error: "Cliente no encontrado para el CUIT informado."
            });
            return;
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});


app.get("/api/pricing-condition-records/:conditionRecord", async (req, res, next) => {
    try {
        const conditionRecord = req.params.conditionRecord;

        const data = await request(PRICING_CONFIG.destinationName, {
            url: "/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgConditionRecord('" + encodeURIComponent(conditionRecord) + "')",
            params: {
                "$format": "json"
            }
        });

        res.json(data && data.d ? data.d : data);
    } catch (error) {
        next(error);
    }
});


app.get("/api/condition-records/:customerId", async (req, res, next) => {
    try {
        const result = await processor.findConditionRecord(req.params.customerId);

        if (!result) {
            res.status(404).json({
                error: "Condition record no encontrado."
            });
            return;
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.use((error, _req, res, _next) => {
    console.error(error);

    res.status(error.status || 500).json({
        error: error.message || "Error interno",
        details: error.response && error.response.data
    });
});

app.listen(port, () => {
    console.log(`Padron ARBA backend escuchando en puerto ${port}`);
});
