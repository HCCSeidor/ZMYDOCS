# ZPERSONDOCS — MIS DOCUMENTOS

Aplicación SAPUI5 para el módulo **File Digital** de HCC Perú. Permite al empleado consultar sus documentos personales agrupados por categoría, visualizarlos en un visor PDF y registrar automáticamente la lectura.

---

## Estado actual

| Capa | Estado |
|------|--------|
| UI / diseño | ✅ Completo — alineado con mockup de referencia |
| Datos hardcodeados | ✅ Completo — estructura ZHRT_INFOTRABAJA simulada |
| Visor PDF | ✅ Completo — iframe con blob URL (patrón ZPAYDOC) |
| Marcar como leído | ✅ Simulado — CSRF dance con setTimeout |
| Bootstrap de usuario | ✅ Simulado — DEMO_USER hardcodeado |
| Deploy en SAP ABAP | ⏳ Pendiente — ZIP listo en `ZPERSONDOCS.zip` |

---

## Arquitectura

```
SAPUI5 Component App (manifest-driven)
│
├── index.html              Bootstrap — carga UI5 1.149.0 desde CDN SAP
├── manifest.json           Descriptor: id "mis.documentos", libs sap.m + sap.ui.table
├── Component.js            UIComponent mínimo — no toca modelos
│
├── controller/
│   ├── BaseController.js   Capa base: getModel / setModel / getRouter
│   └── App.controller.js   Toda la lógica de la pantalla
│
├── view/
│   ├── App.view.xml        Layout principal — TreeTable + filtros de fecha
│   └── ShowPDF.fragment.xml  Dialog visor PDF (patrón ZPAYDOC)
│
├── model/
│   ├── documentos.json     Referencia de estructura (no cargado en runtime)
│   └── sample.pdf          PDF de prueba para simulación local
│
└── css/
    └── style.css           Estilos — paleta naranja #e97600
```

### Patrón de datos

La pantalla trabaja con dos capas:

```
Raw records (ZHRT_INFOTRABAJA shape)
    ↓  mapRawRecordsToTree()
Tree nodes (docs>/documentos[]/children[])
    ↓  TreeTable bindRows()
Vista
```

Cada nodo hoja conserva una referencia `raw` al registro original. Esto permite que `_simulateMarkAsRead` mute solo la fila afectada sin recargar el árbol completo.

---

## Flujo de la aplicación

```
onInit()
  │
  ├─ setModel(JSONModel, "docs")        modelo vacío
  ├─ dpStart / dpEnd = semana actual    lunes → domingo
  ├─ bindRows(treeTable)                binding programático — no en XML
  └─ getUserInfo()
       │
       └─ DEMO_USER ──────────────────► onSearchDocuments()
                                              │
                                              ├─ BusyIndicator.show()
                                              ├─ _simulateGetDocuments(start, end)
                                              │     └─ 500ms → ZHRT_INFOTRABAJA rows
                                              ├─ mapRawRecordsToTree()
                                              ├─ oModel.setData({documentos: tree})
                                              ├─ expandToLevel(2)
                                              └─ BusyIndicator.hide()

[click ojo]
  └─ handleShowPDF()
       │
       ├─ BusyIndicator.show()
       ├─ _simulatePDFLoad(oDoc)
       │     └─ 500ms → fetch("model/sample.pdf") → Blob → blobUrl
       ├─ _openShowPDFDialog(payload)
       │     ├─ Fragment.load("mis.documentos.view.ShowPDF")
       │     ├─ dialog.open()
       │     └─ oFrame.$()[0].src = blobUrl  ← patrón exacto ZPAYDOC
       └─ BusyIndicator.hide()

[cerrar dialog]
  └─ onCloseShowPDF()
       ├─ URL.revokeObjectURL(blobUrl)
       └─ si doc NO leído → _simulateMarkAsRead()
               ├─ 200ms → csrf_token = "CSRF_" + Date.now()  (fetch simulado)
               └─ 300ms → raw.VERDOCUMENTO = "X"             (PATCH simulado)
                          oModel.setProperty(path + "/status", "Aprobado")
                          MessageToast("Documento marcado como leído")
```

---

## Qué reemplazar cuando ABAP entregue los endpoints

### Endpoint 1 — GET documentos por rango

**Archivo:** `webapp/controller/App.controller.js`

**Función:** `_simulateGetDocuments(oStartDate, oEndDate)`

```javascript
// REEMPLAZAR este bloque completo:
_simulateGetDocuments: function (oStartDate, oEndDate) {
    var aAll = buildSampleRawRecords();
    return new Promise(function (resolve) {
        setTimeout(function () {
            var aFiltered = aAll.filter(...);
            resolve(aFiltered);
        }, 500);
    });
},

// POR la llamada OData real (patrón ZPAYDOC):
_simulateGetDocuments: function (oStartDate, oEndDate) {
    var sPerIni = toSapDate(oStartDate);  // "YYYY-MM-DD"
    var sPerFin = toSapDate(oEndDate);
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: "/sap/opu/odata/sap/ZODATA_PERSONDOCS_SRV/PARAMSet" +
                 "?$format=json" +
                 "&$filter=Pernr eq '" + loggeduser + "'" +
                 " and Fecha ge '" + sPerIni + "'" +
                 " and Fecha le '" + sPerFin + "'",
            method: "GET",
            headers: { "Content-Type": "application/json" }
        }).done(function (response) {
            resolve(response.d.results);
        }).fail(reject);
    });
},
```

---

### Endpoint 2 — GET PDF + marcar como leído

**Archivo:** `webapp/controller/App.controller.js`

**Funciones:** `_simulatePDFLoad` y `_simulateMarkAsRead`

```javascript
// REEMPLAZAR _simulatePDFLoad por llamada OData que devuelve Base64:
_simulatePDFLoad: function (oDoc) {
    var oRaw = oDoc.raw;
    return new Promise(function (resolve, reject) {
        $.ajax({
            url: "/sap/opu/odata/sap/ZODATA_PERSONDOCS_SRV/PARAMSet" +
                 "(Pernr='" + oRaw.PERNR + "',Idgrupo='" + oRaw.IDGRUPO +
                 "',Idtipodoc='" + oRaw.IDTIPODOC + "')",
            method: "GET",
            headers: { "Content-Type": "application/json" }
        }).done(function (response) {
            var sBase64 = response.d.Base64;
            // base64ToObjectUrl ya está implementada en el controller
            var sBlobUrl = base64ToObjectUrl(sBase64);
            resolve({
                url: sBlobUrl,
                title: oDoc.name + " - " + oDoc.date,
                isBlobUrl: true
            });
        }).fail(reject);
    });
},

// REEMPLAZAR _simulateMarkAsRead por CSRF dance real (patrón ZPAYDOC):
_simulateMarkAsRead: function (oDoc) {
    var oRaw = oDoc.raw;
    var sEntityUrl = "/sap/opu/odata/sap/ZODATA_PERSONDOCS_SRV/PARAMSet" +
                     "(Pernr='" + oRaw.PERNR + "',Idgrupo='" + oRaw.IDGRUPO +
                     "',Idtipodoc='" + oRaw.IDTIPODOC + "')";
    // Paso 1: capturar CSRF token
    $.ajax({
        url: sEntityUrl,
        method: "GET",
        headers: { "X-CSRF-Token": "fetch" }
    }).done(function (response, status, xhr) {
        csrf_token = xhr.getResponseHeader("X-CSRF-Token");
        // Paso 2: PATCH con el token capturado
        $.ajax({
            url: sEntityUrl,
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            },
            data: JSON.stringify({ Verdocumento: "X" })
        }).done(function () {
            // actualizar modelo igual que la simulación
        });
    });
},
```

---

### Bootstrap de usuario

**Función:** `getUserInfo()`

```javascript
// REEMPLAZAR:
getUserInfo: function () {
    loggeduser = "DEMO_USER";
    this.onSearchDocuments();
},

// POR (patrón ZPAYDOC):
getUserInfo: function () {
    var that = this;
    $.ajax({
        url: "/sap/bc/ui2/start_up",
        method: "GET",
        headers: { "Content-Type": "application/json" }
    }).done(function (response, status, xhr) {
        if (xhr.getResponseHeader("content-type").indexOf("text/html") >= 0) {
            that.getUserInfo(); // redirect a login — reintentar
        } else {
            loggeduser = response.id;
            that.onSearchDocuments();
        }
    });
},
```

---

## Deploy en SAP ABAP

### ZIP listo

```
C:\SAPUI5\ZPERSONDOCS.zip   (240 KB)
```

### Instrucciones para Basis

1. Ejecutar transacción **`/UI5/UI5_REPOSITORY_LOAD`**
2. Configurar:

| Campo | Valor |
|-------|-------|
| Nombre aplicación | `ZPERSONDOCS` |
| Paquete | `ZHCC_PE` |
| Descripción | `MIS DOCUMENTOS` |
| Archivo ZIP | `ZPERSONDOCS.zip` |
| Crear nueva | ✅ |

3. Activar nodo en **SICF** bajo `/sap/bc/ui5_ui5/sap/zpersondocs/`

### URL de acceso

```
https://my64786677.payroll.hr.cloud.sap/sap/bc/ui5_ui5/sap/zpersondocs/index.html?sap-client=100
```

### Deploy automático desde CLI (requiere autorización ADT)

```powershell
cd C:\SAPUI5
pnpm run deploy
# Pide usuario y contraseña SAP interactivamente
# O configura C:\SAPUI5\.env con UI5_TASK_DEPLOY_TARGET_USER / UI5_TASK_DEPLOY_TARGET_PASSWORD
```

---

## Estructura de datos hardcodeada

Los registros simulan la tabla SAP **ZHRT_INFOTRABAJA**:

| Campo | Descripción |
|-------|-------------|
| `MANDT` | Mandante |
| `PERNR` | Número de personal |
| `IDGRUPO` | Grupo de documento (04=Personal, 05=Certificados, etc.) |
| `IDTIPODOC` | Tipo de documento |
| `FECHA` | Fecha del documento (YYYY-MM-DD) |
| `VERDOCUMENTO` | `"X"` = leído, `""` = pendiente |
| `ESTADO` | Estado (`"V"` vigente, `"P"` pendiente) |
| `DOCUMENTO` | Descripción del documento |
| `ADJUNTO` | `"1"` = tiene PDF (en producción será Base64) |

### Grupos de documentos

| IDGRUPO | Nombre |
|---------|--------|
| `01` | Código de Ética |
| `02` | Reglamentos y cargos |
| `03` | Autorizaciones / Compensaciones |
| `04` | Documentos Personales |
| `05` | Certificados de Trabajo, Estudios y Capacitaciones |
| `06` | Documentos de Familiares |
| `07` | Documentos de Ingreso |

---

## Dependencias

```
SAPUI5        1.149.0   (CDN: sapui5.hana.ondemand.com)
@ui5/cli      4.0.56    (build y servidor local)
@sap/ux-ui5-tooling  1.27.0  (deploy a ABAP)
```

```powershell
# Instalar dependencias
pnpm install

# Servidor local
pnpm start
# → http://localhost:8080/index.html

# Build
pnpm exec ui5 build

# Deploy a SAP (requiere autorización ADT)
pnpm run deploy
```
#   Z M Y D O C S  
 