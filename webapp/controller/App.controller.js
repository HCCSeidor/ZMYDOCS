sap.ui.define([
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/ui/core/BusyIndicator",
	"sap/ui/core/Fragment",
	"mis/documentos/controller/BaseController"
], function (JSONModel, MessageToast, MessageBox, BusyIndicator, Fragment,
	BaseController) {
	"use strict";

	// -----------------------------------------------------------------------
	// App.controller (ZPAYDOC-style)
	// -----------------------------------------------------------------------
	// Punto de entrada de la pantalla "Mis Documentos". El controlador
	// extiende BaseController y es dueño del modelo con nombre "docs", del
	// dialogo "ShowPDF" y de los flags de sesion (loggeduser, csrf_token,
	// selectedDoc). Toda la integracion con backend esta simulada para
	// reproducir localmente los tres endpoints reales:
	//
	//   1) GET  /sap/bc/ui2/start_up           -> bootstrap de usuario
	//   2) GET  /sap/opu/.../ZHRT_INFOTRABAJA  -> listado por rango
	//   3) GET  /sap/opu/.../ZHRT_INFOTRABAJA(id)/VisualizeSet
	//        + PATCH .../VisualizeSet          -> visor + marcar leido
	//
	// Cada simulacion devuelve Promise para que el switch a OData/REST sea
	// un drop-in replacement.
	// -----------------------------------------------------------------------

	// Constantes de mapeo ZHRT_INFOTRABAJA -> UI
	var GROUP_LABELS = {
		"01": "Codigo de Etica",
		"02": "Reglamentos y cargos",
		"03": "Autorizaciones/Compensaciones",
		"04": "Documentos Personales",
		"05": "Certificados de Trabajo, Estudios y Capacitaciones",
		"06": "Documentos de Familiares",
		"07": "Documentos de Ingreso"
	};
	var GROUP_ORDER = ["04", "05", "06", "07", "01", "02", "03"];

	var STATUS_APPROVED = "Aprobado";
	var STATUS_PENDING = "Pendiente";

	// PDF de muestra: se sirve como archivo estatico desde model/sample.pdf.
	// En produccion el ABAP entregara Base64 via OData y se usara base64ToObjectUrl().
	var SAMPLE_PDF_URL = "model/sample.pdf";

	// -----------------------------------------------------------------------
	// Estado de sesion (modulo, no global)
	// -----------------------------------------------------------------------
	// Estas variables viven a nivel de modulo: solo esta instancia del
	// controlador las referencia. Antes existian en el core global de UI5;
	// ahora quedan encapsuladas para que multiples instancias no se
	// pisen entre si.
	// -----------------------------------------------------------------------
	var loggeduser = "";
	var csrf_token = "";
	var selectedDoc = null;

	// -----------------------------------------------------------------------
	// Helpers de fecha
	// -----------------------------------------------------------------------
	function getMonday(d) {
		var oDate = new Date(d.getTime());
		var iDay = oDate.getDay();
		var iDiff = oDate.getDate() - iDay + (iDay === 0 ? -6 : 1);
		oDate.setDate(iDiff);
		oDate.setHours(0, 0, 0, 0);
		return oDate;
	}

	function getSundayFromMonday(oMonday) {
		var oSunday = new Date(oMonday.getTime());
		oSunday.setDate(oMonday.getDate() + 6);
		oSunday.setHours(23, 59, 59, 999);
		return oSunday;
	}

	function toSapDate(d) {
		var yyyy = d.getFullYear();
		var mm = String(d.getMonth() + 1).padStart(2, "0");
		var dd = String(d.getDate()).padStart(2, "0");
		return yyyy + "-" + mm + "-" + dd;
	}

	function fromSapDate(sSapDate) {
		if (!sSapDate) { return ""; }
		var aParts = sSapDate.split("-");
		if (aParts.length !== 3) { return sSapDate; }
		return aParts[2] + "/" + aParts[1] + "/" + aParts[0];
	}

	function parseSapDate(sSapDate) {
		if (!sSapDate) { return null; }
		var aParts = sSapDate.split("-");
		if (aParts.length !== 3) { return null; }
		return new Date(parseInt(aParts[0], 10), parseInt(aParts[1], 10) - 1, parseInt(aParts[2], 10));
	}

	// -----------------------------------------------------------------------
	// Filas de ejemplo (ZHRT_INFOTRABAJA-shape)
	// -----------------------------------------------------------------------
	function buildSampleRawRecords() {
		var oNow = new Date();
		function offsetDate(iDays) {
			var d = new Date(oNow.getTime());
			d.setDate(oNow.getDate() + iDays);
			return d;
		}

		// ADJUNTO usa "1" como marcador de que existe PDF — el binario real
		// (SAMPLE_PDF_BASE64) se inyecta solo al abrir el visor. Esto evita
		// almacenar 163KB × N filas en el JSONModel de lista, lo que
		// provocaba que viewable siempre evaluara como false.
		return [
			// 04 Documentos Personales
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "04", IDTIPODOC: "DNI",
				FECHA: toSapDate(offsetDate(-2)), VERDOCUMENTO: "X", ESTADO: "V",
				DOCUMENTO: "Documento Nacional de Identidad",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2009-06-15", HORACRE: "10:23:45"
			},
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "04", IDTIPODOC: "CV",
				FECHA: toSapDate(offsetDate(-4)), VERDOCUMENTO: "", ESTADO: "P",
				DOCUMENTO: "Curriculum Vitae",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2026-01-12", HORACRE: "09:00:00"
			},

			// 05 Certificados de Trabajo, Estudios y Capacitaciones
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "05", IDTIPODOC: "CERTTRAB",
				FECHA: toSapDate(offsetDate(-1)), VERDOCUMENTO: "X", ESTADO: "V",
				DOCUMENTO: "Certificado de Trabajo",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2025-12-10", HORACRE: "14:30:00"
			},

			// 06 Documentos de Familiares
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "06", IDTIPODOC: "ACTAHIJO",
				FECHA: toSapDate(offsetDate(-4)), VERDOCUMENTO: "", ESTADO: "P",
				DOCUMENTO: "Acta de Nacimiento - Hijo",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2024-08-22", HORACRE: "11:15:00"
			},

			// 07 Documentos de Ingreso
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "07", IDTIPODOC: "CONTRATO",
				FECHA: toSapDate(offsetDate(0)), VERDOCUMENTO: "X", ESTADO: "V",
				DOCUMENTO: "Contrato de Trabajo",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2020-03-01", HORACRE: "08:00:00"
			},

			// 01 Codigo de Etica
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "01", IDTIPODOC: "COMPETICA",
				FECHA: toSapDate(offsetDate(-3)), VERDOCUMENTO: "X", ESTADO: "V",
				DOCUMENTO: "Compromiso de Adhesion - Codigo de Etica",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2020-03-01", HORACRE: "08:30:00"
			},
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "01", IDTIPODOC: "DECLJURADA",
				FECHA: toSapDate(offsetDate(-3)), VERDOCUMENTO: "", ESTADO: "P",
				DOCUMENTO: "Declaracion Jurada - Codigo de Etica",
				ADJUNTO: "",
				USUARIOCRE: "P00001", FECHACRE: "2020-03-01", HORACRE: "08:35:00"
			},

			// 02 Reglamentos y cargos
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "02", IDTIPODOC: "REGLINTERNO",
				FECHA: toSapDate(offsetDate(-4)), VERDOCUMENTO: "X", ESTADO: "V",
				DOCUMENTO: "Reglamento Interno de Trabajo",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2020-03-01", HORACRE: "08:45:00"
			},

			// 03 Autorizaciones/Compensaciones
			{
				MANDT: "100", PERNR: "10002345", IDGRUPO: "03", IDTIPODOC: "AUTORIZVAC",
				FECHA: toSapDate(offsetDate(-1)), VERDOCUMENTO: "", ESTADO: "P",
				DOCUMENTO: "Autorizacion de Vacaciones",
				ADJUNTO: "1",
				USUARIOCRE: "P00001", FECHACRE: "2025-11-05", HORACRE: "16:00:00"
			}
		];
	}

	// -----------------------------------------------------------------------
	// Mapping: ZHRT_INFOTRABAJA rows -> TreeTable shape
	// -----------------------------------------------------------------------
	function mapRawRecordsToTree(aRawRecords) {
		var oGroups = {};
		GROUP_ORDER.forEach(function (sIdGrupo) {
			oGroups[sIdGrupo] = {
				id: "g-" + sIdGrupo,
				name: GROUP_LABELS[sIdGrupo],
				date: "",
				status: "",
				viewable: false,
				isGroup: true,
				children: []
			};
		});

		aRawRecords.forEach(function (oRaw) {
			var sIdGrupo = oRaw.IDGRUPO;
			if (!oGroups[sIdGrupo]) {
				return; // codigo de grupo desconocido
			}
			var bHasAdjunto = !!(oRaw.ADJUNTO && oRaw.ADJUNTO.length > 0);
			var sLeafId = "d-" + oRaw.PERNR + "-" + oRaw.IDTIPODOC + "-" + oRaw.FECHA;
			oGroups[sIdGrupo].children.push({
				id: sLeafId,
				name: oRaw.DOCUMENTO || oRaw.IDTIPODOC,
				date: fromSapDate(oRaw.FECHA),
				status: oRaw.VERDOCUMENTO === "X" ? STATUS_APPROVED : STATUS_PENDING,
				viewable: bHasAdjunto,
				isGroup: false,
				children: [],
				// Referencia al registro crudo: necesario para que la
				// simulacion de "marcar leido" pueda mutar VERDOCUMENTO y
				// refrescar el modelo a partir del mismo objeto.
				raw: oRaw
			});
		});

		return GROUP_ORDER.map(function (sIdGrupo) { return oGroups[sIdGrupo]; });
	}

	// -----------------------------------------------------------------------
	// Helpers de PDF (base64 -> Blob -> object URL)
	// -----------------------------------------------------------------------
	function base64ToObjectUrl(sBase64) {
		// Decodifica base64 a bytes en navegador (no atob nativo en IE11,
		// pero SAPUI5 1.149 ya asume navegadores evergreen).
		var sClean = (sBase64 || "").replace(/\s+/g, "");
		var sBinary = atob(sClean);
		var iLen = sBinary.length;
		var aBytes = new Uint8Array(iLen);
		for (var i = 0; i < iLen; i++) {
			aBytes[i] = sBinary.charCodeAt(i);
		}
		var oBlob = new Blob([aBytes], { type: "application/pdf" });
		return URL.createObjectURL(oBlob);
	}

	// -----------------------------------------------------------------------
	// Controller
	// -----------------------------------------------------------------------
	return BaseController.extend("mis.documentos.controller.App", {

		// Cache del dialogo PDF: se carga la primera vez y se reutiliza
		// para aperturas posteriores. Limpiar en onExit es opcional porque
		// Fragment.load + addDependent lo gestionan, pero por seguridad lo
		// destruimos al cerrar.
		_oShowPDF: null,

		onInit: function () {
			// Modelo con nombre "docs" controlado por esta vista. El
			// Component no toca modelos; toda la data nace aqui.
			this.setModel(new JSONModel({ documentos: [] }), "docs");

			// Binding del TreeTable (arrayNames para el nivel de grupo).
			var oTable = this.byId("treeTable");
			if (oTable) {
				oTable.bindRows({
					path: "docs>/documentos",
					parameters: { arrayNames: ["children"] }
				});
			}

			// Bootstrap: el futuro backend expone /sap/bc/ui2/start_up para
			// resolver el usuario logueado. Aqui simulamos que la respuesta
			// llega con id = "DEMO_USER" y disparamos la primera carga.
			this.getUserInfo();
		},

		// -------------------------------------------------------------------
		// getUserInfo: simulacion del endpoint /sap/bc/ui2/start_up
		// -------------------------------------------------------------------
		// En el flujo real:
		//   GET /sap/bc/ui2/start_up
		//     -> 200 application/json { id: <PERNR> } si el SSO esta OK
		//     -> 302 text/html (redirect a login) si la sesion expiro
		// Aqui saltamos la llamada HTTP, fijamos un usuario y avanzamos al
		// listado.
		// -------------------------------------------------------------------
		getUserInfo: function () {
			loggeduser = "DEMO_USER";
			this.onSearchDocuments();
		},

		// -------------------------------------------------------------------
		// onSearchDocuments: carga todos los documentos del usuario
		// -------------------------------------------------------------------
		// Sin filtros de fecha: el backend devuelve todos los documentos
		// activos del colaborador logueado. No se requieren parametros.
		// -------------------------------------------------------------------
		onSearchDocuments: function () {
			var oTable = this.byId("treeTable");
			if (!oTable) { return; }

			BusyIndicator.show(0);
			var that = this;
			this._simulateGetDocuments()
				.then(function (aRawRecords) {
					var aTree = mapRawRecordsToTree(aRawRecords);
					var oModel = that.getModel("docs");
					oModel.setData({ documentos: aTree });

					// Expandir al nivel hoja en el siguiente refresh.
					oTable.attachEventOnce("rowsUpdated", function () {
						try { oTable.expandToLevel(2); } catch (e) { /* noop */ }
					});
					BusyIndicator.hide();
				})
				.catch(function (oErr) {
					BusyIndicator.hide();
					MessageToast.show("Error al cargar documentos");
					// eslint-disable-next-line no-console
					console.error("[App.controller] onSearchDocuments failed", oErr);
				});
		},

		// -------------------------------------------------------------------
		// onGoSFSF: redirige al portal de SuccessFactors (patron ZPAYDOC)
		// -------------------------------------------------------------------
		onGoSFSF: function () {
			window.open("https://hcm-br10.hr.cloud.sap/sf/start", "_self");
		},

		// -------------------------------------------------------------------
		// _simulateGetDocuments: GET /sap/opu/.../ZHRT_INFOTRABAJA
		// -------------------------------------------------------------------
		// Devuelve todos los documentos del colaborador sin filtro de fecha.
		// El delay de 500 ms reproduce el round-trip ABAP para que la UX
		// (BusyIndicator) se vea identica a produccion.
		// -------------------------------------------------------------------
		_simulateGetDocuments: function () {
			var aAll = buildSampleRawRecords();
			return new Promise(function (resolve) {
				setTimeout(function () {
					resolve(aAll);
				}, 500);
			});
		},

		// -------------------------------------------------------------------
		// handleShowPDF: handler del boton "ojo" en la columna Ver Documento
		// -------------------------------------------------------------------
		// Resuelve el binding context, simula la carga del PDF y abre el
		// fragmento ShowPDF inyectando el base64. Al abrirlo, capturedDoc
		// queda retenido para que onCloseShowPDF pueda lanzar la
		// simulacion de "marcar como leido".
		// -------------------------------------------------------------------
		handleShowPDF: function (oEvent) {
			var oSource = oEvent.getSource();
			var oContext = oSource.getBindingContext("docs");
			if (!oContext) { return; }

			var oDoc = oContext.getObject();
			// selectedDoc guarda la hoja, el registro crudo y la path del
			// binding context. Esta path es necesaria para que la accion de
			// "marcar como leido" pueda refrescar solo la fila afectada
			// sin recargar el TreeTable completo.
			selectedDoc = oDoc;
			selectedDoc.__oContextPath = oContext.getPath();

			BusyIndicator.show(0);
			var that = this;
			this._simulatePDFLoad(oDoc)
				.then(function (oPayload) {
					BusyIndicator.hide();
					that._openShowPDFDialog(oPayload);
				})
				.catch(function (oErr) {
					BusyIndicator.hide();
					MessageToast.show("Error al cargar el documento");
					// eslint-disable-next-line no-console
					console.error("[App.controller] handleShowPDF failed", oErr);
				});
		},

		// -------------------------------------------------------------------
		// _simulatePDFLoad: GET /documents/{id}/visualize
		// -------------------------------------------------------------------
		// En produccion: stream binario + ya marca como leido. Aqui solo
		// devolvemos el base64 local y la metadata para el titulo del
		// dialogo. La accion de "marcar leido" se hace al cerrar.
		// -------------------------------------------------------------------
		_simulatePDFLoad: function (oDoc) {
			// Simulacion del pipeline de produccion:
			// 1. En produccion: ABAP devuelve Base64 -> base64ToObjectUrl() -> blob URL
			// 2. Aqui: fetch(sample.pdf) -> blob -> blob URL
			// Ambos prueban exactamente lo mismo: si Chrome en SAP acepta
			// blob: URLs en el iframe. Sin necesitar 163KB de base64 embebido.
			return new Promise(function (resolve) {
				setTimeout(function () {
					var sTitle = (oDoc && oDoc.name ? oDoc.name : "Documento") +
						" - " + (oDoc && oDoc.date ? oDoc.date : "");

					fetch("model/sample.pdf")
						.then(function (oResponse) { return oResponse.blob(); })
						.then(function (oBlob) {
							var sBlobUrl = URL.createObjectURL(oBlob);
							resolve({ url: sBlobUrl, title: sTitle, isBlobUrl: true });
						})
						.catch(function () {
							// Fallback si fetch falla (no deberia pasar en SAP)
							resolve({ url: "model/sample.pdf", title: sTitle, isBlobUrl: false });
						});
				}, 500);
			});
		},

		// -------------------------------------------------------------------
		// _openShowPDFDialog: carga perezosa del fragmento + set del iframe
		// -------------------------------------------------------------------
		_openShowPDFDialog: function (oPayload) {
			var that = this;
			that._sShowPDFUrl = oPayload.url;

			var openIt = function () {
				that._oShowPDF.setTitle(oPayload.title);
				that._oShowPDF.open();

				// Patron ZPAYDOC exacto: obtener el control HTML del iframe
				// via sap.ui.getCore().byId(), acceder al DOM con .$()[0]
				// y asignar src directamente. Para simulacion local se usa
				// la URL estatica; en produccion se pasaria el blobUrl del base64.
				var oFrame = sap.ui.getCore().byId("pdfFrame");
				if (oFrame) {
					var oDomFrame = oFrame.$()[0];
					if (oDomFrame) {
						oDomFrame.style.display = "block";
						oDomFrame.src = oPayload.url;
					}
				}
			};

			if (this._oShowPDF) {
				openIt();
				return;
			}

			Fragment.load({
				name: "mis.documentos.view.ShowPDF",
				controller: this
			}).then(function (oFrag) {
				that._oShowPDF = oFrag;
				that.getView().addDependent(that._oShowPDF);
				openIt();
			}).catch(function (oErr) {
				MessageBox.error("No se pudo abrir el visor de PDF.");
				// eslint-disable-next-line no-console
				console.error("[App.controller] Fragment.load ShowPDF failed", oErr);
			});
		},

		// -------------------------------------------------------------------
		// onDownload: descarga directa del PDF abierto en el iframe
		// -------------------------------------------------------------------
		onDownload: function () {
			if (!selectedDoc) { return; }
			var sName = (selectedDoc.name || "documento").replace(/[^A-Za-z0-9._-]+/g, "_") + ".pdf";
			// Si tenemos un blob URL activo lo usamos; si no, el archivo estatico
			var sHref = (this._sShowPDFUrl && this._sShowPDFUrl.startsWith("blob:"))
				? this._sShowPDFUrl
				: SAMPLE_PDF_URL;
			var oLink = document.createElement("a");
			oLink.href = sHref;
			oLink.download = sName;
			oLink.style.display = "none";
			document.body.appendChild(oLink);
			oLink.click();
			document.body.removeChild(oLink);
		},

		// -------------------------------------------------------------------
		// onCloseShowPDF: handler de Cerrar / Cancelar
		// -------------------------------------------------------------------
		// Cierra el dialogo, revoca la objectURL para no fugar memoria y
		// dispara la simulacion de "marcar como leido" (CSRF dance) si la
		// hoja no estaba ya marcada.
		// -------------------------------------------------------------------
		onCloseShowPDF: function () {
			if (this._oShowPDF) {
				this._oShowPDF.close();
			}
			if (this._sShowPDFUrl) {
				URL.revokeObjectURL(this._sShowPDFUrl);
				this._sShowPDFUrl = null;
			}

			// Marcar como leido solo si el documento tiene adjunto y no
			// estaba ya marcado. En produccion, el GET /visualize ya
			// devuelve el flag actualizado; aqui lo hacemos al cerrar.
			if (selectedDoc && selectedDoc.raw && selectedDoc.raw.VERDOCUMENTO !== "X") {
				this._simulateMarkAsRead(selectedDoc);
			}
		},

		// -------------------------------------------------------------------
		// _simulateMarkAsRead: PATCH /documents/{id} (CSRF dance)
		// -------------------------------------------------------------------
		// Reproduce el patron real de dos pasos:
		//   1) GET  con X-CSRF-Token: fetch     -> captura token
		//   2) PATCH con X-CSRF-Token: <captured> y body {Aceptlectura:"SI"}
		//
		// Aqui no hay red: esperamos 200 ms para "fetch" y 300 ms para
		// "PATCH", y al final mutamos el registro crudo y refrescamos la
		// fila del modelo.
		// -------------------------------------------------------------------
		_simulateMarkAsRead: function (oDoc) {
			if (!oDoc || !oDoc.raw) { return; }

			// Paso 1: captura del token
			setTimeout(function () {
				csrf_token = "CSRF_" + Date.now();

				// Paso 2: PATCH con el token capturado
				setTimeout(function () {
					oDoc.raw.VERDOCUMENTO = "X";
					oDoc.raw.ESTADO = "V";

					// Refrescar la fila del modelo para que la columna
					// Estado pase a "Aprobado" sin recargar todo el Tree.
					var oModel = this.getModel("docs");
					if (oModel) {
						var sPath = oDoc.__oContextPath;
						if (sPath) {
							oModel.setProperty(sPath + "/status", STATUS_APPROVED);
						} else {
							// Fallback: refrescar el modelo completo. Mas
							// costoso pero garantiza consistencia si no
							// pudimos capturar la path del context.
							var oTable = this.byId("treeTable");
							if (oTable) {
								oTable.getBinding("rows").refresh(true);
							}
						}
					}
					MessageToast.show("Documento marcado como leido");
				}.bind(this), 300);
			}.bind(this), 200);
		},

		// -------------------------------------------------------------------
		// onExit: limpieza
		// -------------------------------------------------------------------
		onExit: function () {
			if (this._sShowPDFUrl) {
				URL.revokeObjectURL(this._sShowPDFUrl);
				this._sShowPDFUrl = null;
			}
			if (this._oShowPDF) {
				this._oShowPDF.destroy();
				this._oShowPDF = null;
			}
			selectedDoc = null;
		}

	});

});
