sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("padron.arba.controller.Main", {

        _sContenidoTXT: null,
        _sNombreArchivo: null,

        onInit: function () {
            var oModel = new JSONModel({
                procesado: false,
                procesando: false,
                archivoSeleccionado: false,
                totalRegistros: 0,
                actualizados: 0,
                creados: 0,
                bajas: 0,
                noEncontrados: 0,
                sinCambios: 0,
                ultimaCarga: "",
                registros: []
            });
            this.getView().setModel(oModel, "resultados");

            var oInputFile = document.createElement("input");
            oInputFile.type = "file";
            oInputFile.accept = ".txt";
            oInputFile.style.display = "none";
            oInputFile.id = "hiddenFileInput";
            document.body.appendChild(oInputFile);

            var that = this;

            document.addEventListener("dragover", function (e) {
                e.preventDefault();
                e.stopPropagation();
            });

            document.addEventListener("drop", function (e) {
                e.preventDefault();
                e.stopPropagation();
                var oFile = e.dataTransfer.files[0];
                if (!oFile) return;
                that._procesarArchivo(oFile);
            });

            oInputFile.addEventListener("change", function (oEvent) {
                var oFile = oEvent.target.files[0];
                if (!oFile) return;
                that._procesarArchivo(oFile);
            });
        },

        _procesarArchivo: function (oFile) {
            if (!oFile.name.toLowerCase().endsWith(".txt")) {
                MessageBox.error("El archivo seleccionado no es un TXT válido.");
                return;
            }

            this._sNombreArchivo = oFile.name;

            var oStatus = this.getView().byId("nombreArchivo");
            oStatus.setText(oFile.name);
            oStatus.setState("Success");

            this._oArchivoTXT = oFile;
            this._sContenidoTXT = null;
            this.getView().getModel("resultados").setProperty("/archivoSeleccionado", true);
            MessageToast.show("Archivo seleccionado: " + oFile.name);
            this.onLimpiar(true);
        },

        onSeleccionarArchivo: function () {
            document.getElementById("hiddenFileInput").click();
        },

        onLimpiar: function (bSilencioso) {
            var oModel = this.getView().getModel("resultados");
            oModel.setProperty("/procesado", false);
            oModel.setProperty("/totalRegistros", 0);
            oModel.setProperty("/actualizados", 0);
            oModel.setProperty("/creados", 0);
            oModel.setProperty("/bajas", 0);
            oModel.setProperty("/noEncontrados", 0);
            oModel.setProperty("/sinCambios", 0);
            oModel.setProperty("/registros", []);

            if (!bSilencioso) {
                this._sContenidoTXT = null;
                this._oArchivoTXT = null;
                this._sNombreArchivo = null;
                oModel.setProperty("/archivoSeleccionado", false);
                oModel.setProperty("/ultimaCarga", "");
                oModel.setProperty("/messages", []);
                oModel.setProperty("/showTechnicalDetail", false);
                var oStatus = this.getView().byId("nombreArchivo");
                oStatus.setText("Ningún archivo seleccionado");
                oStatus.setState("None");
                document.getElementById("hiddenFileInput").value = "";
            }
        },

        _formatearFecha: function (sFecha) {
            if (!sFecha || sFecha.length !== 8) return sFecha;
            return sFecha.substring(0, 2) + "/" + sFecha.substring(2, 4) + "/" + sFecha.substring(4, 8);
        },

        onProcesar: function () {
            var oView = this.getView();
            var oModel = oView.getModel("resultados");

            if (!this._sContenidoTXT) {
                MessageToast.show("Por favor seleccioná un archivo TXT primero.");
                return;
            }

            oModel.setProperty("/procesando", true);
            oModel.setProperty("/procesado", false);

            var aLineas = this._sContenidoTXT.split("\n").filter(function (l) {
                return l.trim() !== "";
            });

            var that = this;

            // Intentar leer desde localStorage primero
            // Si no existe, leer desde el JSON en disco
            var sStoredRecords = localStorage.getItem("conditionRecords");

            Promise.all([
                fetch("data/clientes.json").then(function (r) { return r.json(); })
            ]).then(function (aResultados) {
                var aClientes = aResultados[0];
                var aConditionRecords = sStoredRecords
                    ? JSON.parse(sStoredRecords)
                    : [];

                // Si localStorage está vacío cargar desde el JSON
                if (aConditionRecords.length === 0) {
                    return fetch("data/conditionRecords.json")
                        .then(function (r) { return r.json(); })
                        .then(function (aRecordsFromDisk) {
                            return { aClientes: aClientes, aConditionRecords: aRecordsFromDisk };
                        });
                }

                return Promise.resolve({ aClientes: aClientes, aConditionRecords: aConditionRecords });

            }).then(function (oData) {
                var aClientes = oData.aClientes;
                var aConditionRecords = oData.aConditionRecords;

                var aRegistrosProcesados = [];
                var iTotalRegistros = 0;
                var iActualizados = 0;
                var iCreados = 0;
                var iBajas = 0;
                var iNoEncontrados = 0;
                var iSinCambios = 0;

                aLineas.forEach(function (sLinea) {
                    var aCampos = sLinea.split(";");
                    if (aCampos.length < 9) return;

                    // Campo 0: Régimen (solo procesamos P = Percepción)
                    var sRegimen = aCampos[0].trim();
                    if (sRegimen !== "P") return;

                    // Campo 2: Fecha Desde
                    var sFechaDesde = aCampos[2].trim();
                    // Campo 3: Fecha Hasta
                    var sFechaHasta = aCampos[3].trim();
                    // Campo 4: CUIT
                    var sCuit = aCampos[4].trim();
                    // Campo 6: Marca Alta/Baja Sujeto (S=se incorpora, B=baja, N=sin novedad)
                    var sAltaBaja = aCampos[6].trim();
                    // Campo 7: Marca Cambio Alícuota (S=cambió, N=sin cambio)
                    var sCambioAlicuota = aCampos[7].trim();
                    // Campo 8: Alícuota
                    var sAlicuota = aCampos[8].trim().replace(",", ".");

                    iTotalRegistros++;

                    // Buscar el CUIT en clientes
                    var oCliente = aClientes.find(function (c) {
                        return c.cuit === sCuit;
                    });

                    if (!oCliente) {
                        iNoEncontrados++;
                        return;
                    }

                    // Buscar condition record existente
                    var oRecordExistente = aConditionRecords.find(function (r) {
                        return r.customerId === oCliente.customerId;
                    });

                    var sEstado, sEstadoColor, sEstadoIcono;

                    // CASO 1: Contribuyente dado de baja
                    // La baja real es cuando la alícuota es 0 Y no hubo cambio
                    if (sAltaBaja === "B") {
                        if (oRecordExistente) {
                            // Cerrar el condition record con alícuota 0
                            oRecordExistente.alicuota = 0;
                            oRecordExistente.fechaHasta = sFechaHasta;
                        }
                        iBajas++;
                        sEstado      = "Baja";
                        sEstadoColor = "Error";
                        sEstadoIcono = "sap-icon://decline";

                    // CASO 2: Sin cambio de alícuota (Campo 7 = N)
                    } else if (sCambioAlicuota === "N" && oRecordExistente) {
                        // Actualizar alícuota y fechas desde el TXT (ARBA es la fuente de verdad)
                        oRecordExistente.alicuota   = parseFloat(sAlicuota);
                        oRecordExistente.fechaDesde = sFechaDesde;
                        oRecordExistente.fechaHasta = sFechaHasta;
                        iSinCambios++;
                        sEstado      = "Sin cambio";
                        sEstadoColor = "None";
                        sEstadoIcono = "sap-icon://accept";

                    // CASO 3: Actualizar record existente
                    } else if (oRecordExistente) {
                        oRecordExistente.alicuota   = parseFloat(sAlicuota);
                        oRecordExistente.fechaDesde = sFechaDesde;
                        oRecordExistente.fechaHasta = sFechaHasta;
                        iActualizados++;
                        sEstado      = "Actualizado";
                        sEstadoColor = "Success";
                        sEstadoIcono = "sap-icon://synchronize";

                    // CASO 4: Crear record nuevo
                    } else {
                        aConditionRecords.push({
                            customerId:    oCliente.customerId,
                            conditionType: "ZAR1",
                            alicuota:      parseFloat(sAlicuota),
                            fechaDesde:    sFechaDesde,
                            fechaHasta:    sFechaHasta
                        });
                        iCreados++;
                        sEstado      = "Creado";
                        sEstadoColor = "Success";
                        sEstadoIcono = "sap-icon://add-document";
                    }

                    aRegistrosProcesados.push({
                        cuit:        sCuit,
                        nombre:      oCliente.nombre,
                        alicuota:    sAlicuota,
                        fechaDesde:  that._formatearFecha(sFechaDesde),
                        fechaHasta:  that._formatearFecha(sFechaHasta),
                        altaBaja:    sAltaBaja,
                        cambioAlicuota: sCambioAlicuota,
                        estado:      sEstado,
                        estadoColor: sEstadoColor,
                        estadoIcono: sEstadoIcono
                    });
                });

                // Persistir en localStorage
                localStorage.setItem("conditionRecords", JSON.stringify(aConditionRecords));

                var oAhora = new Date();
                var sUltimaCarga = "Última carga: " + oAhora.toLocaleDateString("es-AR") +
                    " " + oAhora.toLocaleTimeString("es-AR");

                var oModel = oView.getModel("resultados");
                var aMessages = [{
                    type: "Success",
                    text: "Carga analizada correctamente. Se identificaron " + (oData.crear || 0) + " registros para crear, " + (oData.modificar || 0) + " para actualizar y " + (oData.noEncontrados || 0) + " no procesables."
                }];

                if ((oData.noEncontrados || 0) > 0) {
                    aMessages.push({
                        type: "Warning",
                        text: "Existen CUIT que no fueron encontrados como clientes en S/4. Esos registros no se procesaran."
                    });
                }

                aMessages.push({
                    type: "Information",
                    text: "El detalle tecnico queda oculto por defecto y puede consultarse desde el boton correspondiente."
                });

                oModel.setData({
                    procesado:           true,
                    procesando:          false,
                    archivoSeleccionado: true,
                    totalRegistros:      iTotalRegistros,
                    actualizados:        iActualizados,
                    creados:             iCreados,
                    bajas:               iBajas,
                    noEncontrados:       iNoEncontrados,
                    sinCambios:          iSinCambios,
                    ultimaCarga:         sUltimaCarga,
                    registros:           aRegistrosProcesados
                });

                MessageToast.show("Procesamiento finalizado.");

            }).catch(function (oError) {
                oModel.setProperty("/procesando", false);
                MessageBox.error("Error en el procesamiento: " + oError.message);
                console.error(oError);
            });
        },

        onProcesarBackend: function () {
            var oView = this.getView();
            var oModel = oView.getModel("resultados");

            if (!this._oArchivoTXT) {
                MessageToast.show("Por favor seleccioná un archivo TXT primero.");
                return;
            }

            oModel.setProperty("/procesando", true);
            oModel.setProperty("/procesado", false);
            oModel.setProperty("/messages", [{
                type: "Information",
                text: "Archivo recibido. Se iniciara el procesamiento en segundo plano."
            }]);

            var that = this;

            var oFormData = new FormData();
            oFormData.append("file", this._oArchivoTXT, this._oArchivoTXT.name);

            this._fetchApi("/api/padron/jobs-upload", {
                method: "POST",
                body: oFormData
            }).then(function (oJob) {
                MessageToast.show("Procesamiento iniciado.");
                return that._esperarJobPadron(oJob.jobId);
            }).then(function (oData) {
                var aRegistros = (oData.registros || []).map(function (oRegistro) {
                    return {
                        cuit: oRegistro.cuit,
                        nombre: oRegistro.nombre || "Cliente no encontrado",
                        alicuota: oRegistro.alicuota,
                        fechaDesde: that._formatearFecha(oRegistro.fechaDesde),
                        fechaHasta: that._formatearFecha(oRegistro.fechaHasta),
                        altaBaja: oRegistro.altaBaja,
                        cambioAlicuota: oRegistro.cambioAlicuota,
                        estado: oRegistro.estado || "Preview",
                        estadoColor: oRegistro.estadoColor || "None",
                        estadoIcono: oRegistro.estadoIcono || "sap-icon://inspect"
                    };
                });

                var oAhora = new Date();
                var sUltimaCarga = "Última carga: " + oAhora.toLocaleDateString("es-AR") +
                    " " + oAhora.toLocaleTimeString("es-AR");

                oModel.setData({
                    procesado: true,
                    procesando: false,
                    archivoSeleccionado: true,
                    totalRegistros: oData.totalRegistros || aRegistros.length,
                    actualizados: oData.modificar || 0,
                    creados: oData.crear || 0,
                    bajas: oData.errores || 0,
                    noEncontrados: oData.noEncontrados || 0,
                    sinCambios: oData.encontrados || 0,
                    ultimaCarga: sUltimaCarga,
                    messages: [{
                        type: "Success",
                        text: "Carga analizada correctamente. Se identificaron " + (oData.crear || 0) + " registros para crear, " + (oData.modificar || 0) + " para actualizar y " + (oData.noEncontrados || 0) + " no procesables."
                    }],
                    showTechnicalDetail: false,
                    registros: aRegistros
                });

                MessageToast.show("Análisis del padrón finalizado.");
            }).catch(function (oError) {
                oModel.setProperty("/procesando", false);
                MessageBox.error("Error al procesar con backend: " + oError.message);
            });
        },

        _esperarJobPadron: function (sJobId) {
            var that = this;

            return new Promise(function (resolve, reject) {
                var iIntentos = 0;
                var iMaxIntentos = 300;

                function consultar() {
                    iIntentos++;

                    that._fetchApi("/api/padron/jobs/" + encodeURIComponent(sJobId))
                        .then(function (oJob) {
                            if (oJob.status === "DONE") {
                                resolve(oJob.result);
                                return;
                            }

                            if (oJob.status === "ERROR") {
                                reject(new Error(oJob.error || "El job finalizó con error."));
                                return;
                            }

                            if (iIntentos >= iMaxIntentos) {
                                reject(new Error("Tiempo de espera agotado consultando el job."));
                                return;
                            }

                            setTimeout(consultar, 2000);
                        })
                        .catch(reject);
                }

                consultar();
            });
        },

        onToggleDetalleTecnico: function () {
            var oModel = this.getView().getModel("resultados");
            var bVisible = !!oModel.getProperty("/showTechnicalDetail");
            oModel.setProperty("/showTechnicalDetail", !bVisible);
        },

        onAplicarS4: function () {
            var oModel = this.getView().getModel("resultados");
            var aRows = oModel.getProperty("/registros") || [];
            var aAplicables = aRows.filter(function (oRow) {
                return !!oRow.cuit;
            });

            if (!aAplicables.length) {
                MessageBox.warning("No hay registros filtrados para aplicar en S/4. Primero procesá el padrón y verificá que existan registros a crear o modificar.");
                return;
            }

            MessageBox.confirm(
                "Se aplicarán cambios reales en S/4 para " + aAplicables.length + " registros filtrados. ¿Continuar?",
                {
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.OK) {
                            return;
                        }

                        oModel.setProperty("/procesando", true);
                        oModel.setProperty("/messages", [{
                            type: "Information",
                            text: "Enviando registros filtrados a S/4..."
                        }]);

                        this._fetchApi("/api/padron/apply-rows", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                rows: aAplicables.map(function (oRow) {
                                    return {
                                        cuit: oRow.cuit,
                                        fechaDesde: String(oRow.fechaDesde || "").replace(/\//g, ""),
                                        fechaHasta: String(oRow.fechaHasta || "").replace(/\//g, ""),
                                        alicuota: oRow.alicuota,
                                        altaBaja: oRow.altaBaja,
                                        cambioAlicuota: oRow.cambioAlicuota
                                    };
                                })
                            })
                        }).then(function (oData) {
                            var oResult = oData.result || {};
                            var oAhora = new Date();
                            var sUltimaCarga = "Última carga: " + oAhora.toLocaleDateString("es-AR") +
                                " " + oAhora.toLocaleTimeString("es-AR");

                            oModel.setProperty("/procesado", true);
                            oModel.setProperty("/procesando", false);
                            oModel.setProperty("/totalRegistros", oResult.totalRegistros || 0);
                            oModel.setProperty("/actualizados", oResult.modificar || 0);
                            oModel.setProperty("/creados", oResult.crear || 0);
                            oModel.setProperty("/bajas", oResult.errores || 0);
                            oModel.setProperty("/noEncontrados", oResult.noEncontrados || 0);
                            oModel.setProperty("/sinCambios", oResult.encontrados || 0);
                            oModel.setProperty("/ultimaCarga", sUltimaCarga);
                            oModel.setProperty("/messages", [{
                                type: "Success",
                                text: "Aplicación finalizada. Registros aplicados en S/4: " + (oResult.aplicados || 0) + "."
                            }]);
                            oModel.setProperty("/registros", oResult.registros || []);

                            MessageToast.show("Aplicación en S/4 finalizada.");
                        }).catch(function (oError) {
                            oModel.setProperty("/procesando", false);
                            MessageBox.error("Error al aplicar en S/4: " + oError.message);
                        });
                    }.bind(this)
                }
            );
        },

        _fetchApi: function (sPath, mOptions) {
            var sCloudApiBase = "https://padron-arba-api.cfapps.us10-001.hana.ondemand.com";
            var bCloudFoundry = window.location.hostname.indexOf("cfapps") !== -1;
            var bPadronJob = sPath.indexOf("/api/padron/jobs") === 0;
            var sUrl = (bCloudFoundry || bPadronJob ? sCloudApiBase : "") + sPath;

            return fetch(sUrl, mOptions).then(function (oResponse) {
                if (!oResponse.ok) {
                    throw new Error("HTTP " + oResponse.status);
                }
                return oResponse.json();
            });
        },

        onVerificarDestinos: function () {
            this._fetchApi("/api/destinations/check")
                .then(function (oData) {
                    var oBP = oData.businessPartnerDestination || {};
                    var oPricing = oData.pricingDestination || {};

                    MessageBox.success(
                        "Destinos conectados correctamente.\n\n" +
                        "Business Partner: " + oBP.name + "\n" +
                        "URL: " + oBP.url + "\n" +
                        "Autenticacion: " + oBP.authentication + "\n\n" +
                        "Pricing: " + oPricing.name + "\n" +
                        "URL: " + oPricing.url + "\n" +
                        "Autenticacion: " + oPricing.authentication
                    );
                })
                .catch(function (oError) {
                    MessageBox.error("No se pudieron verificar los destinos: " + oError.message);
                });
        },

        onBuscar: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            var oTables = this.getView().findAggregatedObjects(true, function (o) {
                return o.isA("sap.m.Table");
            });
            if (!oTables || oTables.length === 0) return;
            var oBinding = oTables[0].getBinding("items");
            if (sQuery) {
                var aFilters = [
                    new Filter("cuit", FilterOperator.Contains, sQuery),
                    new Filter("nombre", FilterOperator.Contains, sQuery)
                ];
                oBinding.filter(new Filter({ filters: aFilters, and: false }));
            } else {
                oBinding.filter([]);
            }
        }

    });
});