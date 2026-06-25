sap.ui.define([
	"sap/ui/core/UIComponent"
], function (UIComponent) {
	"use strict";

	// -----------------------------------------------------------------------
	// Component (capa minima)
	// -----------------------------------------------------------------------
	// El Component no declara modelos: el modelo con nombre "docs" es
	// responsabilidad del App controller. Tampoco se inyectan datos de
	// prueba; el JSON de webapp/model/documentos.json ya no se usa y
	// queda solo como referencia historica. Toda la responsabilidad de
	// bootstrap, formato y bindeo vive en la vista y su controlador.
	// -----------------------------------------------------------------------

	return UIComponent.extend("mis.documentos.Component", {
		metadata: {
			manifest: "json"
		},

		init: function () {
			UIComponent.prototype.init.apply(this, arguments);
		}
	});
});
