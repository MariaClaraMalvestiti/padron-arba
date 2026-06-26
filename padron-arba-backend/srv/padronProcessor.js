const PRICING_CONFIG = require("./pricingConfig");
const { encodeFilterValue, normalizeODataResults, request, requestRaw, fetchCsrfToken } = require("./s4Client");

function parseRate(value) {
    const parsed = Number(String(value || "0").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateForS4(value) {
    if (!value || value.length !== 8) return value;
    return `${value.slice(4, 8)}-${value.slice(2, 4)}-${value.slice(0, 2)}T00:00:00`;
}

function parsePadron(content) {
    return String(content || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(";").map((field) => field.trim()))
        .filter((fields) => fields.length >= 9 && fields[0] === "P")
        .map((fields) => ({
            regimen: fields[0],
            fechaDesde: fields[2],
            fechaHasta: fields[3],
            cuit: fields[4],
            altaBaja: fields[6],
            cambioAlicuota: fields[7],
            alicuota: parseRate(fields[8])
        }));
}

function chunkArray(values, size) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}

async function findBusinessPartnersByCuits(cuits) {
    const uniqueCuits = Array.from(new Set((cuits || []).map(String).filter(Boolean)));
    const bpByCuit = new Map();
    const customerByBp = new Map();

    for (const chunk of chunkArray(uniqueCuits, 40)) {
        const filter = chunk
            .map((cuit) => `BPTaxNumber eq '${encodeFilterValue(cuit)}' or BPTaxLongNumber eq '${encodeFilterValue(cuit)}'`)
            .join(" or ");

        const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
            url: "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber",
            params: {
                "$select": "BusinessPartner,BPTaxNumber,BPTaxLongNumber,BPTaxType",
                "$filter": filter,
                "$format": "json"
            }
        });

        normalizeODataResults(data).forEach((row) => {
            [row.BPTaxNumber, row.BPTaxLongNumber].forEach((value) => {
                const cuit = String(value || "").replace(/\\D/g, "");

                if (cuit.length === 11 && row.BusinessPartner && !bpByCuit.has(cuit)) {
                    bpByCuit.set(cuit, {
                        cuit,
                        businessPartner: row.BusinessPartner,
                        customerId: "",
                        nombre: row.BusinessPartner
                    });
                }
            });
        });
    }

    const businessPartners = Array.from(new Set(
        Array.from(bpByCuit.values()).map((item) => item.businessPartner).filter(Boolean)
    ));

    for (const chunk of chunkArray(businessPartners, 40)) {
        const filter = chunk
            .map((bp) => `BusinessPartner eq '${encodeFilterValue(bp)}'`)
            .join(" or ");

        const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
            url: "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner",
            params: {
                "$select": "BusinessPartner,Customer,BusinessPartnerFullName,OrganizationBPName1,SearchTerm1",
                "$filter": filter,
                "$format": "json"
            }
        });

        normalizeODataResults(data).forEach((bp) => {
            if (bp.BusinessPartner && bp.Customer) {
                customerByBp.set(bp.BusinessPartner, {
                    customerId: bp.Customer,
                    nombre: bp.BusinessPartnerFullName || bp.OrganizationBPName1 || bp.SearchTerm1 || bp.Customer
                });
            }
        });
    }

    bpByCuit.forEach((value, cuit) => {
        const customerData = customerByBp.get(value.businessPartner);

        if (!customerData || !customerData.customerId) {
            bpByCuit.delete(cuit);
            return;
        }

        value.customerId = customerData.customerId;
        value.nombre = customerData.nombre;
    });

    return bpByCuit;
}

async function findBusinessPartnerByCuit(cuit) {
    const data = await request(PRICING_CONFIG.businessPartnerDestinationName, {
        url: "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerTaxNumber",
        params: {
            "$select": "BusinessPartner,BPTaxNumber,BPTaxType",
            "$filter": `BPTaxNumber eq '${encodeFilterValue(cuit)}'`,
            "$format": "json"
        }
    });

    const taxRows = normalizeODataResults(data);
    if (taxRows.length === 0) return null;

    const businessPartner = taxRows[0].BusinessPartner;

    const bpData = await request(PRICING_CONFIG.businessPartnerDestinationName, {
        url: `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${encodeURIComponent(businessPartner)}')`,
        params: {
            "$select": "BusinessPartner,Customer,BusinessPartnerFullName,OrganizationBPName1,SearchTerm1",
            "$format": "json"
        }
    });

    const bpRows = normalizeODataResults(bpData);
    const bp = bpRows[0] || {};

    if (!bp.Customer) {
        return null;
    }

    return {
        cuit,
        businessPartner,
        customerId: bp.Customer,
        nombre: bp.BusinessPartnerFullName || bp.OrganizationBPName1 || bp.SearchTerm1 || bp.Customer
    };
}


const CUSTOMER_TAX_GROUPING_CONFIG = {
    code: "IB2",
    endDate: "9999-12-31T00:00:00"
};

function escapeODataKey(value) {
    return String(value || "").replace(/'/g, "''");
}

function getCustomerTaxGroupingKeyPath(customerId) {
    return "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerTaxGrouping(Customer='" +
        escapeODataKey(customerId) +
        "',CustomerTaxGroupingCode='" +
        escapeODataKey(CUSTOMER_TAX_GROUPING_CONFIG.code) +
        "')";
}

function getCustomerTaxGroupingNavigationPath(customerId) {
    return "/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Customer('" +
        escapeODataKey(customerId) +
        "')/to_CustomerTaxGrouping";
}

async function fetchBusinessPartnerCsrfToken() {
    return fetchCsrfToken(
        PRICING_CONFIG.businessPartnerDestinationName,
        "/sap/opu/odata/sap/API_BUSINESS_PARTNER/"
    );
}

async function findCustomerTaxGroupingIB2(customerId) {
    const response = await requestRaw(PRICING_CONFIG.businessPartnerDestinationName, {
        method: "GET",
        url: getCustomerTaxGroupingKeyPath(customerId),
        headers: {
            "Accept": "application/json"
        }
    });

    if (response.status === 404) {
        return null;
    }

    const text = await response.text();

    if (!response.ok) {
        throw new Error("HTTP " + response.status + " al consultar categoria fiscal IB2: " + text);
    }

    const data = text ? JSON.parse(text) : {};
    return data && data.d ? data.d : data;
}

async function createCustomerTaxGroupingIB2(customerId, registro, csrfToken) {
    const payload = {
    CustomerTaxGroupingCode: CUSTOMER_TAX_GROUPING_CONFIG.code,
    CustTaxGroupSubjectedStartDate: formatDateForS4(registro.fechaDesde),
    CustTaxGroupSubjectedEndDate: CUSTOMER_TAX_GROUPING_CONFIG.endDate
};

    const response = await requestRaw(PRICING_CONFIG.businessPartnerDestinationName, {
        method: "POST",
        url: getCustomerTaxGroupingNavigationPath(customerId),
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": csrfToken.token,
            "Cookie": csrfToken.cookie
        },
        data: payload
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error("HTTP " + response.status + " al crear categoria fiscal IB2: " + text);
    }

    return text ? JSON.parse(text) : {};
}

async function updateCustomerTaxGroupingIB2(customerId, registro, csrfToken) {
    const payload = {
        CustTaxGroupSubjectedStartDate: formatDateForS4(registro.fechaDesde),
        CustTaxGroupSubjectedEndDate: CUSTOMER_TAX_GROUPING_CONFIG.endDate
    };

    const response = await requestRaw(PRICING_CONFIG.businessPartnerDestinationName, {
        method: "PATCH",
        url: getCustomerTaxGroupingKeyPath(customerId),
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": csrfToken.token,
            "Cookie": csrfToken.cookie,
            "If-Match": "*"
        },
        data: payload
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error("HTTP " + response.status + " al actualizar categoria fiscal IB2: " + text);
    }

    return text ? JSON.parse(text) : {};
}

async function ensureCustomerTaxGroupingIB2(customerId, registro, csrfToken) {
    const existing = await findCustomerTaxGroupingIB2(customerId);

    if (existing) {
        await updateCustomerTaxGroupingIB2(customerId, registro, csrfToken);
        return "actualizada";
    }

    await createCustomerTaxGroupingIB2(customerId, registro, csrfToken);
    return "creada";
}

async function findConditionRecord(customerId) {
    const data = await request(PRICING_CONFIG.destinationName, {
        url: "/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgCndnRecdValidity",
        params: {
            "$filter": [
                `ConditionType eq '${encodeFilterValue(PRICING_CONFIG.conditionType)}'`,
                `Customer eq '${encodeFilterValue(customerId)}'`
            ].join(" and "),
            "$format": "json"
        }
    });

    return normalizeODataResults(data)[0] || null;
}

function buildConditionPayload(registro, customerId, existingRecord) {
    return {
        ConditionRecord: existingRecord && existingRecord.ConditionRecord,
        ConditionTable: PRICING_CONFIG.conditionTable,
        ConditionType: PRICING_CONFIG.conditionType,
        ConditionRateValue: registro.altaBaja === "B" ? "0" : String(registro.alicuota),
        ConditionRateValueUnit: PRICING_CONFIG.rateUnit,
        ConditionValidityStartDate: formatDateForS4(registro.fechaDesde),
        ConditionValidityEndDate: formatDateForS4(registro.fechaHasta),
        Customer: customerId,
        DepartureCountry: PRICING_CONFIG.country,
        TaxCode: PRICING_CONFIG.taxCode,
        ConditionCurrency: PRICING_CONFIG.currency
    };
}


async function fetchPricingCsrfToken() {
    return fetchCsrfToken(
        PRICING_CONFIG.destinationName,
        "/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/"
    );
}

function normalizeRate(value) {
    return String(Number(value || 0));
}

async function readConditionRecordEtag(conditionRecord) {
    const response = await requestRaw(PRICING_CONFIG.destinationName, {
        method: "GET",
        url: `/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgConditionRecord('${encodeURIComponent(conditionRecord)}')`,
        headers: {
            accept: "application/json"
        }
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} al leer ETag de condicion: ${text}`);
    }

    const data = text ? JSON.parse(text) : {};
    const etag = data && data.d && data.d.__metadata && data.d.__metadata.etag;

    if (!etag) {
        throw new Error(`No se pudo obtener ETag de la condicion ${conditionRecord}`);
    }

    return etag;
}

async function createPricingCondition(registro, customerId, csrfToken) {
    const payload = {
        ConditionTable: PRICING_CONFIG.conditionTable,
        ConditionType: PRICING_CONFIG.conditionType,
        ConditionRateValue: normalizeRate(registro.alicuota),
        ConditionRateValueUnit: PRICING_CONFIG.rateUnit,
        ConditionTaxCode: PRICING_CONFIG.taxCode,
        to_SlsPrcgCndnRecdValidity: [
            {
                ConditionValidityStartDate: formatDateForS4(registro.fechaDesde),
                ConditionValidityEndDate: formatDateForS4(registro.fechaHasta),
                ConditionType: PRICING_CONFIG.conditionType,
                Country: PRICING_CONFIG.country,
                Customer: customerId
            }
        ]
    };

    const response = await requestRaw(PRICING_CONFIG.destinationName, {
        method: "POST",
        url: "/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgConditionRecord",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-csrf-token": csrfToken.token,
            cookie: csrfToken.cookie
        },
        data: payload
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} al crear condicion: ${text}`);
    }

    return text ? JSON.parse(text) : {};
}

async function updatePricingCondition(conditionRecord, registro, csrfToken) {
    const etag = await readConditionRecordEtag(conditionRecord);

    const payload = {
        ConditionRateValue: normalizeRate(registro.alicuota),
        ConditionRateValueUnit: PRICING_CONFIG.rateUnit,
        ConditionTaxCode: PRICING_CONFIG.taxCode
    };

    const response = await requestRaw(PRICING_CONFIG.destinationName, {
        method: "PATCH",
        url: `/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgConditionRecord('${encodeURIComponent(conditionRecord)}')`,
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-csrf-token": csrfToken.token,
            cookie: csrfToken.cookie,
            "if-match": etag
        },
        data: payload
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} al actualizar condicion: ${text}`);
    }

    return text ? JSON.parse(text) : {};
}

async function findConditionRecordForValidity(customerId, fechaDesde, fechaHasta) {
    const startDate = formatDateForS4(fechaDesde);
    const endDate = formatDateForS4(fechaHasta);

    const data = await request(PRICING_CONFIG.destinationName, {
        url: "/sap/opu/odata/sap/API_SLSPRICINGCONDITIONRECORD_SRV/A_SlsPrcgCndnRecdValidity",
        params: {
            "$filter": [
                `ConditionType eq '${encodeFilterValue(PRICING_CONFIG.conditionType)}'`,
                `Customer eq '${encodeFilterValue(customerId)}'`,
                `ConditionValidityStartDate eq datetime'${startDate}'`,
                `ConditionValidityEndDate eq datetime'${endDate}'`
            ].join(" and "),
            "$format": "json"
        }
    });

    return normalizeODataResults(data)[0] || null;
}

async function previewPadron(content, options) {
    const maxRecords = options && options.maxRecords ? options.maxRecords : 250;
    const cuitFilter = options && options.cuits && options.cuits.length
        ? new Set(options.cuits.map(String))
        : null;

    const registros = parsePadron(content)
        .filter(function (registro) {
            return !cuitFilter || cuitFilter.has(String(registro.cuit));
        })
        .slice(0, maxRecords);

    const clientesPorCuit = await findBusinessPartnersByCuits(
        registros.map((registro) => registro.cuit)
    );

    const resumen = {
        totalRegistros: registros.length,
        encontrados: 0,
        noEncontrados: 0,
        crear: 0,
        modificar: 0,
        errores: 0,
        registros: []
    };

    const bpCsrfToken = await fetchBusinessPartnerCsrfToken();

    for (const registro of registros) {
        const item = {
            cuit: registro.cuit,
            fechaDesde: registro.fechaDesde,
            fechaHasta: registro.fechaHasta,
            alicuota: registro.alicuota,
            altaBaja: registro.altaBaja,
            cambioAlicuota: registro.cambioAlicuota
        };

        let cliente;
        try {
            cliente = clientesPorCuit.get(String(registro.cuit)) || null;
        } catch (error) {
            resumen.errores += 1;
            resumen.registros.push(Object.assign(item, {
                nombre: "Error consultando BP",
                estado: "Error BP",
                estadoColor: "Error",
                estadoIcono: "sap-icon://error",
                detalle: error.message
            }));
            continue;
        }

        if (!cliente) {
            resumen.noEncontrados += 1;
            resumen.registros.push(Object.assign(item, {
                nombre: "Cliente no encontrado",
                estado: "No procesar",
                estadoColor: "Warning",
                estadoIcono: "sap-icon://alert",
                accion: "Cliente no encontrado en S/4"
            }));
            continue;
        }

        resumen.encontrados += 1;

        try {
            const ib2Status = await ensureCustomerTaxGroupingIB2(cliente.customerId, registro, bpCsrfToken);
            item.categoriaFiscal = "IB2";
            item.categoriaFiscalEstado = ib2Status;
        } catch (error) {
            resumen.errores += 1;
            resumen.registros.push(Object.assign(item, cliente, {
                estado: "Error categoria fiscal",
                estadoColor: "Error",
                estadoIcono: "sap-icon://error",
                accion: "No se pudo actualizar categoria fiscal IB2",
                detalle: error.message
            }));
            continue;
        }

        try {
            const conditionRecord = await findConditionRecordForValidity(
                cliente.customerId,
                registro.fechaDesde,
                registro.fechaHasta
            );

            if (conditionRecord) {
                resumen.modificar += 1;
                resumen.registros.push(Object.assign(item, cliente, {
                    conditionRecord: conditionRecord.ConditionRecord,
                    estado: "Modificar",
                    estadoColor: "Success",
                    estadoIcono: "sap-icon://edit",
                    accion: "Modificar condicion existente"
                }));
            } else {
                resumen.crear += 1;
                resumen.registros.push(Object.assign(item, cliente, {
                    estado: "Crear",
                    estadoColor: "Information",
                    estadoIcono: "sap-icon://add-document",
                    accion: "Crear condicion para la vigencia"
                }));
            }
        } catch (error) {
            resumen.errores += 1;
            resumen.registros.push(Object.assign(item, cliente, {
                estado: "Error condicion",
                estadoColor: "Error",
                estadoIcono: "sap-icon://error",
                accion: "No se pudo consultar condition record",
                detalle: error.message
            }));
        }
    }

    return resumen;
}

async function applyPadron(content, options) {
    const resumen = await previewPadron(content, options);
    const csrfToken = await fetchPricingCsrfToken();

    resumen.aplicados = 0;

    for (const item of resumen.registros) {
        if (item.estado !== "Crear" && item.estado !== "Modificar") {
            continue;
        }

        const registro = {
            cuit: item.cuit,
            fechaDesde: item.fechaDesde,
            fechaHasta: item.fechaHasta,
            alicuota: item.alicuota,
            altaBaja: item.altaBaja,
            cambioAlicuota: item.cambioAlicuota
        };

        try {
            if (item.estado === "Crear") {
                const response = await createPricingCondition(registro, item.customerId, csrfToken);
                item.estado = "Creado";
                item.estadoColor = "Success";
                item.accion = "Condicion creada en S/4";
                item.conditionRecord = response && response.d && response.d.ConditionRecord;
            } else {
                await updatePricingCondition(item.conditionRecord, registro, csrfToken);
                item.estado = "Actualizado";
                item.estadoColor = "Success";
                item.accion = "Condicion actualizada en S/4";
            }

            resumen.aplicados += 1;
        } catch (error) {
            resumen.errores += 1;
            item.estado = "Error escritura";
            item.estadoColor = "Error";
            item.estadoIcono = "sap-icon://error";
            item.accion = "No se pudo escribir en S/4";
            item.detalle = error.message;
        }
    }

    return resumen;
}


module.exports = {
    parsePadron,
    findBusinessPartnerByCuit,
    findBusinessPartnersByCuits,
    findConditionRecord,
    buildConditionPayload,
    findConditionRecordForValidity,
    fetchPricingCsrfToken,
    fetchBusinessPartnerCsrfToken,
    ensureCustomerTaxGroupingIB2,
    createPricingCondition,
    updatePricingCondition,
    previewPadron,
    applyPadron
};
