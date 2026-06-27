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
	// App.controller — ZPERSONDOCS "Mis Documentos" (Yambal)
	// -----------------------------------------------------------------------
	// Patron de referencia: ZPAYDOC (deployado en produccion en el mismo
	// servidor SAP).
	//
	// ESTADO ACTUAL: frontend completo con simulacion local.
	// Pendiente: reemplazar los metodos marcados con [REEMPLAZAR ABAP]
	// cuando el equipo ABAP entregue los 2 endpoints indicados en README.md.
	//
	// ENDPOINTS QUE ABAP DEBE ENTREGAR
	// -----------------------------------------------------------------------
	//
	// [ENDPOINT 1] Bootstrap de usuario logueado
	//   GET /sap/bc/ui2/start_up
	//   -> Respuesta JSON: { "id": "<PERNR>" }
	//   -> Si devuelve text/html: sesion expirada, redirigir a login
	//   -> Este endpoint ya existe en el servidor (lo usa ZPAYDOC)
	//   -> Reemplazar en: getUserInfo()
	//
	// [ENDPOINT 2] Listado de documentos del colaborador
	//   GET /sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet
	//         ?$format=json
	//         &$filter=Pernr eq '<PERNR>'
	//   -> Sin filtro de periodo (no hay buscador de fechas en este formulario)
	//   -> El campo ADJUNTO de cada fila YA CONTIENE el Base64 del PDF
	//      (confirmado en tabla ZHRT_INFOTRABAJA — columna ADJUNTO)
	//   -> El frontend decodifica ADJUNTO con base64ToObjectUrl() al abrir el visor
	//   -> Reemplazar en: _simulateGetDocuments() y _simulatePDFLoad()
	//
	// [MARCAR COMO LEIDO] CSRF dance sobre el mismo servicio del Endpoint 2
	//   Paso 1: GET con header X-CSRF-Token: fetch -> captura token
	//   Paso 2: PATCH con X-CSRF-Token: <token> y body { "Aceptlectura": "SI" }
	//   -> Patron identico a ZPAYDOC (funcion UpdateFlag en Main.controller.js)
	//   -> Reemplazar en: _simulateMarkAsRead()
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
		// getUserInfo                              [REEMPLAZAR ABAP - EP1]
		// -------------------------------------------------------------------
		// SIMULACION: fija loggeduser = "DEMO_USER" y carga documentos.
		//
		// REEMPLAZAR CON:
		//   $.ajax({ url: "/sap/bc/ui2/start_up", method: "GET",
		//            headers: { "Content-Type": "application/json" } })
		//     .done(function(response, textStatus, xhr) {
		//       if (xhr.getResponseHeader("content-type").indexOf("text/html") >= 0) {
		//         // sesion expirada — recargar para redirigir a login SAP
		//         location.reload();
		//         return;
		//       }
		//       loggeduser = response.id;   // PERNR del colaborador logueado
		//       that.onSearchDocuments();
		//     });
		// -------------------------------------------------------------------
		getUserInfo: function () {
			// [SIMULACION — reemplazar con llamada real a /sap/bc/ui2/start_up]
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
		// _simulateGetDocuments                    [REEMPLAZAR ABAP - EP2]
		// -------------------------------------------------------------------
		// SIMULACION: devuelve filas hardcodeadas con shape ZHRT_INFOTRABAJA.
		//
		// REEMPLAZAR CON:
		//   var sUrl = "/sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet"
		//            + "?$format=json&$filter=Pernr eq '" + loggeduser + "'";
		//   return new Promise(function(resolve, reject) {
		//     $.ajax({ url: sUrl, method: "GET",
		//              headers: { "Content-Type": "application/json" } })
		//       .done(function(resp) { resolve(resp.d.results); })
		//       .fail(function(err)  { reject(err); });
		//   });
		//
		// CAMPOS QUE EL FRONTEND CONSUME DE CADA FILA:
		//   PERNR, IDGRUPO, IDTIPODOC, FECHA (YYYY-MM-DD),
		//   VERDOCUMENTO ("X"=leido / ""=pendiente),
		//   DOCUMENTO (nombre visible), ADJUNTO (Base64 PDF o "1" si existe)
		// -------------------------------------------------------------------
		_simulateGetDocuments: function () {
			// [SIMULACION — reemplazar con llamada OData al servicio ABAP]
			var aAll = buildSampleRawRecords();
			return new Promise(function (resolve) {
				setTimeout(function () { resolve(aAll); }, 500);
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
		// _simulatePDFLoad              [REEMPLAZAR ABAP - EP2 / visor PDF]
		// -------------------------------------------------------------------
		// SIMULACION: carga model/sample.pdf como blob URL local.
		//
		// REEMPLAZAR CON:
		//   El campo ADJUNTO del Endpoint 2 ya contiene el Base64 del PDF.
		//   Solo hay que decodificarlo con la funcion base64ToObjectUrl()
		//   que ya existe en este controller:
		//
		//   var sTitle = oDoc.name + " - " + oDoc.date;
		//   var sBlobUrl = base64ToObjectUrl(oDoc.raw.ADJUNTO);
		//   return Promise.resolve({ url: sBlobUrl, title: sTitle, isBlobUrl: true });
		//
		//   No se necesita una llamada HTTP adicional para obtener el PDF.
		// -------------------------------------------------------------------
		_simulatePDFLoad: function (oDoc) {
			// [SIMULACION — en produccion usar: base64ToObjectUrl(oDoc.raw.ADJUNTO)]
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
		// onCloseShowPDF: cierra el dialog y dispara el CSRF dance
		// -------------------------------------------------------------------
		onCloseShowPDF: function () {
			if (this._oShowPDF) {
				this._oShowPDF.close();
			}
			if (this._sShowPDFUrl) {
				URL.revokeObjectURL(this._sShowPDFUrl);
				this._sShowPDFUrl = null;
			}

			// Enviar el PATCH al cerrar. El status visible en la tabla
			// lo determina el backend en la siguiente carga — el frontend
			// no muta nada localmente.
			if (selectedDoc && selectedDoc.raw) {
				this._simulateMarkAsRead(selectedDoc);
			}
		},

		// -------------------------------------------------------------------
		// _simulateMarkAsRead              [REEMPLAZAR ABAP - EP3 paso B]
		// -------------------------------------------------------------------
		// SIMULACION: solo imprime en consola — no muta el modelo local.
		//
		// REEMPLAZAR CON (patron CSRF identico a ZPAYDOC / UpdateFlag):
		//   var sBaseUrl = "/sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet("
		//     + "Pernr='" + oDoc.raw.PERNR + "'"
		//     + ",Idtipodoc='" + oDoc.raw.IDTIPODOC + "'"
		//     + ")";
		//   // Paso 1: capturar CSRF token
		//   $.ajax({ url: sBaseUrl, method: "GET",
		//            headers: { "Content-Type": "application/json",
		//                       "X-CSRF-Token": "fetch" } })
		//     .done(function(response, textStatus, xhr) {
		//       csrf_token = xhr.getResponseHeader("X-CSRF-Token");
		//       // Paso 2: PATCH para registrar la lectura
		//       $.ajax({ url: sBaseUrl, method: "PATCH",
		//                headers: { "Content-Type": "application/json",
		//                           "X-CSRF-Token": csrf_token },
		//                data: JSON.stringify({ "Aceptlectura": "SI" }) })
		//         .done(function() {
		//           // El status lo devuelve el backend en el siguiente GET.
		//           // No se muta el modelo local.
		//         });
		//     });
		// -------------------------------------------------------------------
		_simulateMarkAsRead: function (oDoc) {
			if (!oDoc || !oDoc.raw) { return; }
			// [SIMULACION — en produccion reemplazar con el CSRF dance real]
			// eslint-disable-next-line no-console
			console.log("[simulacion] PATCH marcar leido:", oDoc.raw.PERNR, oDoc.raw.IDTIPODOC);
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
