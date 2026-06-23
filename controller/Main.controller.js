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

            var that = this;
            var oReader = new FileReader();
            oReader.onload = function (e) {
                that._sContenidoTXT = e.target.result;
                that.getView().getModel("resultados").setProperty("/archivoSeleccionado", true);
                MessageToast.show("Archivo cargado: " + oFile.name);
            };
            oReader.readAsText(oFile, "windows-1252");

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
                this._sNombreArchivo = null;
                oModel.setProperty("/archivoSeleccionado", false);
                oModel.setProperty("/ultimaCarga", "");
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