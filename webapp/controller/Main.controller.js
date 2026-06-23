sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) {
    "use strict";

    var INITIAL_STATE = {
        procesado: false,
        procesando: false,
        archivoSeleccionado: false,
        puedeAplicarCambios: false,
        totalRegistros: 0,
        actualizados: 0,
        creados: 0,
        bajas: 0,
        noEncontrados: 0,
        sinCambios: 0,
        ultimaCarga: "",
        registros: [],
        messages: [],
        jobId: "",
        jobStatus: "",
        showTechnicalDetail: false,
        jobs: [],
        showJobsHistory: false
    };

    return Controller.extend("padron.arba.controller.Main", {

        _sContenidoTXT: null,
        _oArchivoTXT: null,
        _sNombreArchivo: null,
        _jobPollTimer: null,

        onAfterRendering: function () {
            var that = this;
            this._ajustarBotonesUsuarioFinal();

            setTimeout(function () {
                that._ajustarBotonesUsuarioFinal();
            }, 300);
        },

        _ajustarBotonesUsuarioFinal: function () {
            var aButtons = this.getView().findAggregatedObjects(true, function (oControl) {
                return oControl.isA && oControl.isA("sap.m.Button");
            });

            aButtons.forEach(function (oButton) {
                var sText = oButton.getText ? oButton.getText() : "";

                if (sText.indexOf("Verificar") >= 0) {
                    oButton.setVisible(false);
                }

                if (sText.indexOf("Aplicar") >= 0 && sText.indexOf("S/4") >= 0) {
                    oButton.setText("Aplicar cambios");
                }
            });
        },

        onInit: function () {
            var oModel = new JSONModel(Object.assign({}, INITIAL_STATE));
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

            this._loadJobsHistory();

        },

        _loadJobsHistory: function () {
            var oModel = this.getView().getModel("resultados");

            return fetch("/api/padron/jobs", {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            }).then(function (oResponse) {
                return oResponse.json().then(function (oData) {
                    if (!oResponse.ok) {
                        throw new Error(oData.error || "HTTP " + oResponse.status);
                    }

                    return oData;
                });
            }).then(function (oData) {
                var aJobs = Array.isArray(oData.jobs) ? oData.jobs : [];

                aJobs = aJobs.map(function (oJob) {
                    var oSummary = oJob.summary || {};
                    var sFecha = oJob.createdAt ? new Date(oJob.createdAt).toLocaleString("es-AR") : "-";
                    var iTotal = oSummary.totalRegistros || 0;
                    var iEncontrados = oSummary.encontrados || 0;

                    oJob.titulo = "Carga del " + sFecha;
                    var sEstado = oJob.status === "DONE" ? "Finalizado" :
                        oJob.status === "RUNNING" ? "En proceso" :
                        oJob.status === "PENDING" ? "Pendiente" :
                        oJob.status === "ERROR" ? "Error" :
                        (oJob.status || "-");

                    oJob.descripcion = "Estado: " + sEstado +
                        " | Encontrados: " + iEncontrados +
                        " | No encontrados: " + (oSummary.noEncontrados || 0);
                    oJob.info = iTotal ? String(iTotal) + " registros" : "";

                    return oJob;
                });

                oModel.setProperty("/jobs", aJobs);
            }).catch(function () {
                oModel.setProperty("/jobs", []);
            });
        },

        onToggleHistorial: function () {
            var oModel = this.getView().getModel("resultados");
            var bVisible = !!oModel.getProperty("/showJobsHistory");

            oModel.setProperty("/showJobsHistory", !bVisible);

            if (!bVisible) {
                this._loadJobsHistory();
            }
        },

        onSeleccionarJob: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("resultados");
            var oJob = oContext ? oContext.getObject() : null;

            if (!oJob || !oJob.id) {
                return;
            }

            this._loadJobResult(oJob.id);
        },

        _loadJobResult: function (sJobId) {
            var that = this;
            var oModel = this.getView().getModel("resultados");

            return fetch("/api/padron/jobs/" + encodeURIComponent(sJobId), {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            }).then(function (oResponse) {
                return oResponse.json().then(function (oData) {
                    if (!oResponse.ok) {
                        throw new Error(oData.error || "HTTP " + oResponse.status);
                    }

                    return oData;
                });
            }).then(function (oJob) {
                var oSummary = oJob.result || oJob.summary || {};
                var aRegistros = oJob.result && Array.isArray(oJob.result.registros) ? oJob.result.registros : [];

                oModel.setProperty("/jobId", oJob.id || sJobId);
                oModel.setProperty("/jobStatus", oJob.status || "");
                oModel.setProperty("/totalRegistros", oSummary.totalRegistros || 0);
                oModel.setProperty("/sinCambios", oSummary.encontrados || 0);
                oModel.setProperty("/noEncontrados", oSummary.noEncontrados || 0);
                oModel.setProperty("/creados", oSummary.crear || 0);
                oModel.setProperty("/actualizados", oSummary.modificar || 0);
                oModel.setProperty("/puedeAplicarCambios", ((oSummary.crear || 0) + (oSummary.modificar || 0)) > 0);
                oModel.setProperty("/bajas", oSummary.errores || 0);
                oModel.setProperty("/registros", aRegistros);
                oModel.setProperty("/procesado", true);
                oModel.setProperty("/procesando", oJob.status === "RUNNING" || oJob.status === "PENDING");
                oModel.setProperty("/messages", [{
                    type: oJob.status === "ERROR" ? "Error" : "Information",
                    text: oJob.message || ("Carga seleccionada. Estado: " + (oJob.status || "-"))
                }]);

                if (oJob.status === "RUNNING" || oJob.status === "PENDING") {
                    that._startJobPolling(oJob.id || sJobId);
                }
            }).catch(function (oError) {
                MessageBox.error("No se pudo cargar el job seleccionado: " + (oError.message || oError));
            });
        },

        onExit: function () {
            this._stopJobPolling();
        },

        _procesarArchivo: function (oFile) {
            if (!oFile.name.toLowerCase().endsWith(".txt")) {
                MessageBox.error("El archivo seleccionado no es un TXT válido.");
                return;
            }

            this.onLimpiar(true);

            this._sNombreArchivo = oFile.name;
            this._oArchivoTXT = oFile;
            this._sContenidoTXT = null;

            var oStatus = this.getView().byId("nombreArchivo");
            oStatus.setText(oFile.name);
            oStatus.setState("Success");

            this.getView().getModel("resultados").setProperty("/archivoSeleccionado", true);
            this._mostrarResumenInicialArchivo(oFile);
            MessageToast.show("Archivo seleccionado: " + oFile.name);
        },

        onSeleccionarArchivo: function () {
            document.getElementById("hiddenFileInput").click();
        },

        onLimpiar: function (bSilencioso) {
            this._stopJobPolling();
            window.localStorage.removeItem("padronesArbaLastJobId");

            var oModel = this.getView().getModel("resultados");
            oModel.setData(Object.assign({}, INITIAL_STATE));

            if (!bSilencioso) {
                this._sContenidoTXT = null;
                this._oArchivoTXT = null;
                this._sNombreArchivo = null;
                var oStatus = this.getView().byId("nombreArchivo");
                oStatus.setText("Ningún archivo seleccionado");
                oStatus.setState("None");
                document.getElementById("hiddenFileInput").value = "";
                MessageToast.show("Carga limpiada.");
            }
        },

        _mostrarResumenInicialArchivo: function (oFile) {
            var oModel = this.getView().getModel("resultados");

            oModel.setProperty("/procesando", true);
            oModel.setProperty("/procesado", true);
            oModel.setProperty("/totalRegistros", 0);
            oModel.setProperty("/actualizados", 0);
            oModel.setProperty("/creados", 0);
            oModel.setProperty("/sinCambios", 0);
            oModel.setProperty("/bajas", 0);
            oModel.setProperty("/noEncontrados", 0);
            oModel.setProperty("/registros", []);
            oModel.setProperty("/puedeAplicarCambios", false);
            oModel.setProperty("/messages", [{
                type: "Information",
                text: "Leyendo archivo seleccionado..."
            }]);

            this._leerCuitsPadronPorChunks(oFile, function (oProgress) {
                oModel.setProperty("/totalRegistros", oProgress.totalRegistros || 0);
                oModel.setProperty("/messages", [{
                    type: "Information",
                    text: "Archivo seleccionado. Registros detectados: " + (oProgress.totalRegistros || 0) + ". Pendiente de procesamiento."
                }]);
            }).then(function (oLectura) {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/totalRegistros", oLectura.totalRegistros || 0);
                oModel.setProperty("/messages", [{
                    type: "Information",
                    text: "Archivo seleccionado. Registros detectados: " + (oLectura.totalRegistros || 0) + ". Presioná Procesar Padrón para analizarlo."
                }]);
            }).catch(function () {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/messages", [{
                    type: "Warning",
                    text: "Archivo seleccionado. No se pudo calcular la cantidad de registros antes del procesamiento."
                }]);
            });
        },

        onProcesarBackend: function () {
            var that = this;
            var oModel = this.getView().getModel("resultados");

            if (!this._oArchivoTXT) {
                MessageToast.show("Por favor seleccioná un archivo TXT primero.");
                return;
            }

            this._stopJobPolling();

            oModel.setProperty("/procesando", true);
            oModel.setProperty("/procesado", false);
            oModel.setProperty("/messages", [{
                type: "Information",
                text: "Subiendo padrón por partes..."
            }]);

            this._subirPadronPorChunks(this._oArchivoTXT).then(function (oJob) {
                var sJobId = oJob.jobId || oJob.id;

                oModel.setProperty("/jobId", sJobId);
                oModel.setProperty("/jobStatus", oJob.status || "PENDING");
                oModel.setProperty("/messages", [{
                    type: "Information",
                    text: "Archivo subido. Job de filtrado iniciado. ID: " + sJobId
                }]);

                that._startJobPolling(sJobId);
            }).catch(function (oError) {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/messages", [{
                    type: "Error",
                    text: "No se pudo subir/procesar el padrón: " + (oError.message || oError)
                }]);
                MessageBox.error("No se pudo subir/procesar el padrón: " + (oError.message || oError));
            });
        },

        onAplicarS4: function () {
            var that = this;
            var oModel = this.getView().getModel("resultados");
            var aRows = oModel.getProperty("/registros") || [];

            var aAplicables = aRows.filter(function (oRow) {
                return oRow && oRow.customerId && (
                    oRow.estado === "Crear" ||
                    oRow.estado === "Modificar" ||
                    oRow.estado === "Listo para aplicar en S/4"
                );
            });

            if (!aAplicables.length) {
                MessageBox.warning("Primero procesá el padrón. Solo se puede aplicar en S/4 cuando hay clientes encontrados y listos para crear o actualizar.");
                return;
            }

            MessageBox.confirm(
                "Se va a aplicar " + aAplicables.length + " " + (aAplicables.length === 1 ? "cliente encontrado" : "clientes encontrados") + " en S/4. Esta acción modifica datos reales. ¿Continuar?",
                {
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.OK) {
                            return;
                        }

                        that._startApplyJob(aAplicables);
                    }
                }
            );
        },

        _subirPadronPorChunks: function (oFile) {
            var oModel = this.getView().getModel("resultados");
            var iChunkSize = 15 * 1024 * 1024;
            var iTotalChunks = Math.ceil(oFile.size / iChunkSize);
            var sUploadId = "upload-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
            var iIndex = 0;

            function enviarSiguiente() {
                var iStart = iIndex * iChunkSize;
                var iEnd = Math.min(iStart + iChunkSize, oFile.size);
                var oChunk = oFile.slice(iStart, iEnd);
                var oFormData = new FormData();

                oFormData.append("uploadId", sUploadId);
                oFormData.append("fileName", oFile.name);
                oFormData.append("chunkIndex", String(iIndex));
                oFormData.append("totalChunks", String(iTotalChunks));
                oFormData.append("chunk", oChunk, oFile.name + ".part" + iIndex);

                oModel.setProperty("/messages", [{
                    type: "Information",
                    text: "Subiendo archivo: " + Math.round(((iIndex + 1) / iTotalChunks) * 100) + "% (" + (iIndex + 1) + " de " + iTotalChunks + "). No cierres esta pestaña."
                }]);

                return fetch("/api/padron/upload-chunk", {
                    method: "POST",
                    body: oFormData
                }).then(function (oResponse) {
                    return oResponse.text().then(function (sText) {
                        var oData = {};

                        try {
                            oData = sText ? JSON.parse(sText) : {};
                        } catch (e) {
                            throw new Error(sText || "Respuesta no JSON del servidor.");
                        }

                        if (!oResponse.ok) {
                            throw new Error(oData.error || sText || "HTTP " + oResponse.status);
                        }

                        return oData;
                    });
                }).then(function (oData) {
                    iIndex += 1;

                    if (iIndex < iTotalChunks) {
                        return enviarSiguiente();
                    }

                    return oData;
                });
            }

            return enviarSiguiente();
        },

        _startApplyJob: function (aRows) {
            var that = this;
            var oModel = this.getView().getModel("resultados");
            var sSourceJobId = oModel.getProperty("/jobId") || "";

            this._stopJobPolling();

            oModel.setProperty("/procesando", true);
            oModel.setProperty("/messages", [{
                type: "Information",
                text: "Iniciando aplicación en S/4 en segundo plano..."
            }]);

            fetch("/api/padron/apply-job", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                      jobId: sSourceJobId
                })
            }).then(function (oResponse) {
                return oResponse.json().then(function (oData) {
                    if (!oResponse.ok) {
                        throw new Error(oData.error || "HTTP " + oResponse.status);
                    }
                    return oData;
                });
            }).then(function (oJob) {
                var sJobId = oJob.jobId || oJob.id;

                oModel.setProperty("/jobId", sJobId);
                oModel.setProperty("/jobStatus", oJob.status || "PENDING");
                oModel.setProperty("/messages", [{
                    type: "Information",
                    text: "Job de aplicación iniciado. ID: " + sJobId
                }]);

                that._startJobPolling(sJobId);
            }).catch(function (oError) {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/messages", [{
                    type: "Error",
                    text: "No se pudo iniciar la aplicación en S/4: " + (oError.message || oError)
                }]);
                MessageBox.error("No se pudo iniciar la aplicación en S/4: " + (oError.message || oError));
            });
        },

        _startJobPolling: function (sJobId) {
            var that = this;
            this._pollJobStatus(sJobId);
            this._jobPollTimer = setInterval(function () {
                that._pollJobStatus(sJobId);
            }, 5000);
        },

        _stopJobPolling: function () {
            if (this._jobPollTimer) {
                clearInterval(this._jobPollTimer);
                this._jobPollTimer = null;
            }
        },

        _pollJobStatus: function (sJobId) {
            var that = this;
            var oModel = this.getView().getModel("resultados");

            fetch("/api/padron/jobs/" + encodeURIComponent(sJobId), {
                method: "GET",
                headers: { "Accept": "application/json" }
            }).then(function (oResponse) {
                return oResponse.json().then(function (oData) {
                    if (!oResponse.ok) {
                        throw new Error(oData.error || "HTTP " + oResponse.status);
                    }
                    return oData;
                });
            }).then(function (oJob) {
                var sStatus = oJob.status || "";
                var bFinished = sStatus === "DONE" || sStatus === "ERROR" ||
                    sStatus === "FINALIZADO" || sStatus === "FINALIZADO_CON_ERRORES";

                oModel.setProperty("/jobStatus", sStatus);

                var oSummary = oJob.result || oJob.summary || {};
                // Polling legacy desactivado para no pisar el resumen del filtrado por CUIT.
                if (oSummary.encontrados)    oModel.setProperty("/sinCambios", oSummary.encontrados);
                if (oSummary.noEncontrados)  oModel.setProperty("/noEncontrados", oSummary.noEncontrados);
                oModel.setProperty("/totalRegistros", oSummary.totalRegistros || 0);
                oModel.setProperty("/sinCambios", oSummary.encontrados || 0);
                oModel.setProperty("/noEncontrados", oSummary.noEncontrados || 0);
                oModel.setProperty("/creados", oSummary.crear || 0);
                oModel.setProperty("/actualizados", oSummary.modificar || 0);
                oModel.setProperty("/puedeAplicarCambios", ((oSummary.crear || 0) + (oSummary.modificar || 0)) > 0);
                oModel.setProperty("/bajas", oSummary.errores || 0);

                var aRegistros = [];

                if (oJob.result && Array.isArray(oJob.result.registros)) {
                    aRegistros = oJob.result.registros;
                } else if (oJob.summary && Array.isArray(oJob.summary.registros)) {
                    aRegistros = oJob.summary.registros;
                } else {
                    aRegistros = oModel.getProperty("/registros") || [];
                }

                oModel.setProperty("/registros", aRegistros);

                if (bFinished) {
                    that._stopJobPolling();
                    window.localStorage.removeItem("padronesArbaLastJobId");
                    oModel.setProperty("/procesando", false);
                    oModel.setProperty("/procesado", true);

                    var oAhora = new Date();
                    oModel.setProperty("/ultimaCarga",
                        "Última carga: " + oAhora.toLocaleString("es-AR"));

                    if (sStatus === "DONE" || sStatus === "FINALIZADO") {
                        var bApplyJob = oJob.result && Object.prototype.hasOwnProperty.call(oJob.result, "aplicados");

                        oModel.setProperty("/messages", [{
                            type: "Success",
                            text: bApplyJob
                                ? "Aplicación en S/4 finalizada. Creados: " + (oSummary.crear || 0) +
                                    ". Modificados: " + (oSummary.modificar || 0) +
                                    ". Errores: " + (oSummary.errores || 0) + "."
                                : "Análisis terminado. Registros evaluados: " + (oSummary.totalRegistros || 0) +
                                    ". Clientes encontrados: " + (oSummary.encontrados || 0) +
                                    ". Listos para aplicar: " + ((oSummary.crear || 0) + (oSummary.modificar || 0)) +
                                    ". No encontrados: " + (oSummary.noEncontrados || 0) + "."
                        }]);
                        if (bApplyJob) {
                            MessageBox.success("Aplicación en S/4 finalizada.");
                        } else {
                            MessageToast.show("Análisis terminado. Revisá el resumen antes de aplicar en S/4.");
                        }
                    } else {
                        var sErrorMsg = oJob.error || "El job finalizó con errores.";
                        oModel.setProperty("/messages", [{
                            type: "Error",
                            text: "Job finalizado con error: " + sErrorMsg
                        }]);
                        MessageBox.error(sErrorMsg);
                    }
                } else {
                    oModel.setProperty("/messages", [{
                        type: "Information",
                        text: "Job en proceso (ID: " + sJobId + "). Estado: " + sStatus +
                            ". Actualizando cada 5 segundos..."
                    }]);
                }
            }).catch(function (oError) {
                that._stopJobPolling();
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/messages", [{
                    type: "Error",
                    text: "No se pudo consultar el estado del job: " + (oError.message || oError)
                }]);
            });
        },

        onVerificarDestinos: function () {
            var oModel = this.getView().getModel("resultados");
            oModel.setProperty("/procesando", true);
            oModel.setProperty("/messages", [{
                type: "Information",
                text: "Verificando destinos S/4 HANA..."
            }]);

            fetch("/api/destinations/check", {
                method: "GET",
                headers: { "Accept": "application/json" }
            }).then(function (oResponse) {
                return oResponse.json();
            }).then(function (oData) {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/procesado", true);

                var bpDest = oData.businessPartnerDestination || {};
                var pricingDest = oData.pricingDestination || {};

                oModel.setProperty("/messages", [
                    {
                        type: bpDest.found ? "Success" : "Error",
                        text: "Destino BP (" + (bpDest.name || "S4HANA-BP") + "): " +
                            (bpDest.found ? "OK — " + bpDest.url : "NO ENCONTRADO")
                    },
                    {
                        type: pricingDest.found ? "Success" : "Error",
                        text: "Destino Pricing (" + (pricingDest.name || "S4HANA-PRICING") + "): " +
                            (pricingDest.found ? "OK — " + pricingDest.url : "NO ENCONTRADO")
                    }
                ]);
            }).catch(function (oError) {
                oModel.setProperty("/procesando", false);
                oModel.setProperty("/messages", [{
                    type: "Error",
                    text: "Error al verificar destinos: " + (oError.message || oError)
                }]);
            });
        },

        onToggleDetalleTecnico: function () {
            var oModel = this.getView().getModel("resultados");
            var bActual = oModel.getProperty("/showTechnicalDetail");
            oModel.setProperty("/showTechnicalDetail", !bActual);
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
        },

        _leerArchivoPorChunks: function (oFile, fnProcesarLinea, fnProgress) {
            var iChunkSize = 2 * 1024 * 1024;
            var iOffset = 0;
            var sPendiente = "";
            var iTotal = oFile.size;
            var iTotalRegistros = 0;

            function leerSiguiente() {
                if (iOffset >= iTotal) {
                    if (sPendiente.trim()) {
                        fnProcesarLinea(sPendiente);
                        iTotalRegistros += 1;
                    }

                    return Promise.resolve({
                        totalRegistros: iTotalRegistros
                    });
                }

                var oBlob = oFile.slice(iOffset, iOffset + iChunkSize);
                iOffset += iChunkSize;

                return new Promise(function (resolve, reject) {
                    var oReader = new FileReader();

                    oReader.onload = function (oEvent) {
                        var sTexto = sPendiente + (oEvent.target.result || "");
                        var aLineas = sTexto.split(/\r?\n/);

                        sPendiente = aLineas.pop() || "";

                        aLineas.forEach(function (sLinea) {
                            if (sLinea.trim()) {
                                fnProcesarLinea(sLinea);
                                iTotalRegistros += 1;
                            }
                        });

                        if (fnProgress) {
                            fnProgress({
                                percent: Math.min(100, Math.round((iOffset / iTotal) * 100)),
                                totalRegistros: iTotalRegistros
                            });
                        }

                        setTimeout(function () {
                            leerSiguiente().then(resolve).catch(reject);
                        }, 0);
                    };

                    oReader.onerror = function () {
                        reject(new Error("No se pudo leer el archivo por partes."));
                    };

                    oReader.readAsText(oBlob, "windows-1252");
                });
            }

            return leerSiguiente();
        },

        _leerCuitsPadronPorChunks: function (oFile, fnProgress) {
            var oCuits = new Set();

            return this._leerArchivoPorChunks(oFile, function (sLinea) {
                var aFields = sLinea.trim().split(";").map(function (sField) {
                    return sField.trim();
                });

                if (aFields.length >= 9 && aFields[0] === "P" && aFields[4]) {
                    oCuits.add(String(aFields[4]));
                }
            }, fnProgress).then(function (oResult) {
                return {
                    totalRegistros: oResult.totalRegistros,
                    cuits: Array.from(oCuits).slice(0, 15000)
                };
            });
        },

        _leerRegistrosAplicablesPorChunks: function (oFile, mClientesPorCuit) {
            var aFiltrados = [];

            return this._leerArchivoPorChunks(oFile, function (sLinea) {
                var aFields = sLinea.trim().split(";").map(function (sField) {
                    return sField.trim();
                });

                if (aFields.length < 9 || aFields[0] !== "P") {
                    return;
                }

                var sCuit = String(aFields[4] || "");
                var oCliente = mClientesPorCuit[sCuit];

                if (!oCliente || !oCliente.customerId) {
                    return;
                }

                var fAlicuota = Number(String(aFields[8] || "0").replace(",", "."));

                aFiltrados.push({
                    cuit: sCuit,
                    fechaDesde: aFields[2],
                    fechaHasta: aFields[3],
                    alicuota: Number.isFinite(fAlicuota) ? fAlicuota : 0,
                    altaBaja: aFields[6],
                    cambioAlicuota: aFields[7],
                    businessPartner: oCliente.businessPartner,
                    customerId: oCliente.customerId,
                    nombre: oCliente.nombre || oCliente.customerId,
                    estado: "Crear",
                    estadoColor: "Information",
                    estadoIcono: "sap-icon://add-document",
                    accion: "Registro filtrado para procesar en S/4"
                });
            }).then(function () {
                return aFiltrados;
            });
        },

        _refrescarCacheBusinessPartners: function (aCuits) {
            var iBatchSize = 200;
            var aPendientes = Array.isArray(aCuits) ? aCuits.slice() : [];

            function refrescarLote() {
                var aLote = aPendientes.splice(0, iBatchSize);

                if (!aLote.length) {
                    return Promise.resolve();
                }

                return fetch("/api/business-partners/cache/refresh", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        cuits: aLote
                    })
                }).then(function (oResponse) {
                    return oResponse.text().then(function (sText) {
                        var oData;

                        try {
                            oData = sText ? JSON.parse(sText) : {};
                        } catch (oError) {
                            throw new Error(sText || "Respuesta no JSON del backend");
                        }

                        if (!oResponse.ok) {
                            throw new Error(oData.error || "HTTP " + oResponse.status);
                        }

                        return refrescarLote();
                    });
                });
            }

            return refrescarLote();
        },

        _resolverBusinessPartnersCache: function (aCuits) {
            return fetch("/api/business-partners/resolve-cached", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    cuits: aCuits
                })
            }).then(function (oResponse) {
                return oResponse.json().then(function (oData) {
                    if (!oResponse.ok) {
                        throw new Error(oData.error || "HTTP " + oResponse.status);
                    }
                    return oData;
                });
            });
        },

        _resolverBusinessPartnersPorLotes: function (aCuits) {
            var iBatchSize = 200;
            var aPendientes = Array.isArray(aCuits) ? aCuits.slice() : [];
            var aEncontrados = [];
            var iRequested = aPendientes.length;

            function procesarLote() {
                var aLote = aPendientes.splice(0, iBatchSize);

                if (!aLote.length) {
                    return Promise.resolve({
                        requested: iRequested,
                        found: aEncontrados.length,
                        businessPartners: aEncontrados
                    });
                }

                return fetch("/api/business-partners/resolve", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        cuits: aLote
                    })
                }).then(function (oResponse) {
                    return oResponse.text().then(function (sText) {
                        var oData;

                        try {
                            oData = sText ? JSON.parse(sText) : {};
                        } catch (oError) {
                            throw new Error(sText || "Respuesta no JSON del backend");
                        }

                        if (!oResponse.ok) {
                            throw new Error(oData.error || "HTTP " + oResponse.status);
                        }

                        Array.prototype.push.apply(aEncontrados, oData.businessPartners || []);
                        return procesarLote();
                    });
                });
            }

            return procesarLote();
        },

        _parsearPadronFrontend: function (sContent) {
            return String(sContent || "")
                .split(/\r?\n/)
                .map(function (sLine) {
                    return sLine.trim();
                })
                .filter(Boolean)
                .map(function (sLine) {
                    return sLine.split(";").map(function (sField) {
                        return sField.trim();
                    });
                })
                .filter(function (aFields) {
                    return aFields.length >= 9 && aFields[0] === "P";
                })
                .map(function (aFields) {
                    var fAlicuota = Number(String(aFields[8] || "0").replace(",", "."));
                    return {
                        cuit: aFields[4],
                        fechaDesde: aFields[2],
                        fechaHasta: aFields[3],
                        alicuota: Number.isFinite(fAlicuota) ? fAlicuota : 0,
                        altaBaja: aFields[6],
                        cambioAlicuota: aFields[7]
                    };
                });
        },

        _formatearFecha: function (sFecha) {
            if (!sFecha || sFecha.length !== 8) return sFecha;
            return sFecha.substring(0, 2) + "/" + sFecha.substring(2, 4) + "/" + sFecha.substring(4, 8);
        }

    });
});
