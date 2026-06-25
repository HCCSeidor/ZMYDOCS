sap.ui.define([
	"sap/ui/core/mvc/Controller"
], function (Controller) {
	"use strict";

	// -----------------------------------------------------------------------
	// BaseController
	// -----------------------------------------------------------------------
	// Capa minima que centraliza el acceso a modelos con nombre del view y
	// opcionalmente expone el router cuando el manifest define rutas. Las
	// pantallas concretas (App.controller) lo extienden para heredar
	// getModel / setModel sin reescribir la indireccion a sap.ui.getCore().
	// -----------------------------------------------------------------------
	return Controller.extend("mis.documentos.controller.BaseController", {

		// Acceso tipado a modelos con nombre. Devuelve undefined si la vista
		// todavia no esta asociada (p. ej. durante la instanciacion).
		getModel: function (sName) {
			return this.getView() ? this.getView().getModel(sName) : undefined;
		},

		// Registro de modelos con nombre. Si la vista no existe, no-op
		// defensivo para que el onInit no lance antes de que UI5 resuelva
		// el binding.
		setModel: function (oModel, sName) {
			if (this.getView()) {
				this.getView().setModel(oModel, sName);
			}
			return this;
		},

		// Acceso al router cuando el manifest define sap.ui5.routing. La
		// app actual no navega entre pantallas, asi que el metodo se expone
		// solo para que vistas futuras puedan hacer navTo sin tocar el
		// nucleo de UIComponent.
		getRouter: function () {
			return sap.ui.core.UIComponent.getRouterFor(this);
		}

	});

});
