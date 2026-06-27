# ZPERSONDOCS — Mis Documentos (Yambal)

Formulario SAPUI5 para la visualización de documentos personales del colaborador.
Desarrollado siguiendo el mismo estándar y arquitectura de **ZPAYDOC** (Documentos de planilla), que ya está deployado y en producción en el mismo servidor SAP.

---

## Estado actual

| Capa | Estado |
|------|--------|
| Frontend / Layout | ✅ Completo — listo para deploy |
| Simulación de datos | ✅ Activa (datos hardcodeados en controller) |
| Integración ABAP | ⏳ Pendiente — requiere los 2 endpoints detallados abajo |

**El equipo ABAP debe entregar los endpoints.** El frontend ya está preparado para recibirlos: cada función simulada tiene el código real comentado como reemplazo directo (`[REEMPLAZAR ABAP]`).

---

## Identificadores del proyecto

| Campo | Valor |
|-------|-------|
| BSP App | `ZPERSONDOCS` |
| Namespace SAPUI5 | `mis.documentos` |
| Paquete de prueba | `$TMP` |
| Paquete final | `ZHCC_PE` |
| Ruta local | `C:\SAPUI5` |
| URL final en producción | `/sap/bc/ui5_ui5/sap/zpersondocs/index.html?sap-client=100` |
| Referencia de arquitectura | `C:\Proyectos de GUIA UI5\ZPAYDOC` |

---

## Lo que NO tiene este formulario (decisión confirmada por BG/Luis)

- ❌ No hay filtros **Período Inicio / Período Fin**
- ❌ No hay botón **Cargar Documentos**
- ✅ Sí tiene botón **Volver a Successfactors** (igual a ZPAYDOC)
- ✅ Los documentos se muestran todos sin filtro de fecha

---

## Endpoints que ABAP debe entregar

### Endpoint 1 — Bootstrap de usuario logueado

Este endpoint **ya existe en el servidor**; es el mismo que usa ZPAYDOC en producción.

```
GET /sap/bc/ui2/start_up
Headers: Content-Type: application/json
```

**Respuesta esperada:**

```json
{ "id": "10002345" }
```

> `id` es el `PERNR` del colaborador cuya sesión SSO está activa.

Si la respuesta es `text/html`, la sesión expiró y se debe redirigir a login.

**Función a reemplazar:** `getUserInfo()` en `App.controller.js`

---

### Endpoint 2 — Listado de documentos del colaborador

El equipo ABAP debe exponer un servicio OData que devuelva todos los documentos de la tabla (o vista) `ZHRT_INFOTRABAJA` para el `PERNR` logueado, **sin filtro de período**.

```
GET /sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet
    ?$format=json
    &$filter=Pernr eq '<PERNR>'
Headers: Content-Type: application/json
```

**Estructura de respuesta esperada:**

```json
{
  "d": {
    "results": [
      {
        "MANDT":       "100",
        "PERNR":       "10002345",
        "IDGRUPO":     "04",
        "IDTIPODOC":   "DNI",
        "FECHA":       "2026-06-24",
        "VERDOCUMENTO":"X",
        "ESTADO":      "V",
        "DOCUMENTO":   "Documento Nacional de Identidad",
        "ADJUNTO":     "<base64_del_pdf_o_cadena_no_vacia_si_existe>"
      }
    ]
  }
}
```

**Campos requeridos por el frontend:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `PERNR` | String | Número de personal |
| `IDGRUPO` | String | Código de grupo (ver tabla abajo) |
| `IDTIPODOC` | String | Código de tipo de documento |
| `FECHA` | String `YYYY-MM-DD` | Fecha de emisión del documento |
| `VERDOCUMENTO` | String | `"X"` = leído/aprobado, `""` = pendiente |
| `DOCUMENTO` | String | Nombre visible del documento en la tabla |
| `ADJUNTO` | String | Base64 del PDF **o** cualquier valor no vacío si existe PDF |

**Grupos esperados (`IDGRUPO`):**

| Código | Grupo visible |
|--------|--------------|
| `01` | Código de Ética |
| `02` | Reglamentos y cargos |
| `03` | Autorizaciones/Compensaciones |
| `04` | Documentos Personales |
| `05` | Certificados de Trabajo, Estudios y Capacitaciones |
| `06` | Documentos de Familiares |
| `07` | Documentos de Ingreso |

**Función a reemplazar:** `_simulateGetDocuments()` en `App.controller.js`

---

### Endpoint 3 — Obtener PDF y marcar como leído

Se compone de dos pasos, igual al patrón que usa ZPAYDOC en producción con `ZODATA_FORMULARIO_SRV` + `ZODATA_DOCUMENTO_PEND_Y_VISTOS_SRV`.

#### Paso A — Obtener el PDF (Base64)

```
GET /sap/opu/odata/sap/<SERVICIO_PDF_ABAP>/ZHRTDocSet
    ?$format=json
    &$filter=Pernr eq '<PERNR>' and Idtipodoc eq '<IDTIPODOC>'
Headers: Content-Type: application/json
```

**Respuesta esperada:**

```json
{
  "d": {
    "results": [
      { "Base64": "<cadena_base64_del_pdf>" }
    ]
  }
}
```

El frontend convierte el Base64 a Blob URL usando la función `base64ToObjectUrl()` (ya existe en el controller) y lo inyecta en el iframe. Patrón idéntico a ZPAYDOC.

#### Paso B — Marcar como leído (CSRF dance)

Igual al patrón de ZPAYDOC (`UpdateFlag`):

```
// Paso 1: capturar token
GET /sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet(Pernr='...',Idtipodoc='...')
Headers: X-CSRF-Token: fetch
→ Guardar el token del header X-CSRF-Token de la respuesta

// Paso 2: marcar leído
PATCH /sap/opu/odata/sap/<SERVICIO_ABAP>/ZHRTInfotSet(Pernr='...',Idtipodoc='...')
Headers: Content-Type: application/json
         X-CSRF-Token: <token_capturado>
Body:    { "Aceptlectura": "SI" }
```

**Funciones a reemplazar:** `_simulatePDFLoad()` y `_simulateMarkAsRead()` en `App.controller.js`

---

## Archivos a modificar para la integración

```
C:\SAPUI5\webapp\controller\App.controller.js
```

Buscar las tres etiquetas `[REEMPLAZAR ABAP]`:

| Etiqueta | Función | Endpoint |
|----------|---------|----------|
| `[REEMPLAZAR ABAP - EP1]` | `getUserInfo()` | EP1 — `/sap/bc/ui2/start_up` |
| `[REEMPLAZAR ABAP - EP2]` | `_simulateGetDocuments()` | EP2 — Listado OData |
| `[REEMPLAZAR ABAP - EP3 paso A]` | `_simulatePDFLoad()` | EP3 — PDF Base64 |
| `[REEMPLAZAR ABAP - EP3 paso B]` | `_simulateMarkAsRead()` | EP3 — CSRF + PATCH |

Cada etiqueta tiene el **código real listo como comentario** — solo hay que descomentar y ajustar el nombre del servicio ABAP.

---

## Deploy al repositorio ABAP

### Opción A — Subida manual (recomendada, sin dependencia de permisos ADT)

1. Construir el ZIP actualizado:
   ```
   cd C:\SAPUI5
   pnpm exec ui5 build
   ```
   Luego comprimir la carpeta `dist/` como `ZPERSONDOCS.zip`.

2. En SAP GUI, ejecutar desde **SE38** o **SA38**:
   ```
   /UI5/UI5_REPOSITORY_LOAD
   ```
   > ⚠️ Es un **reporte/programa**, no una transacción. No funciona desde el campo de comandos.

3. Parámetros:
   | Campo | Valor |
   |-------|-------|
   | Nombre BSP App | `ZPERSONDOCS` |
   | Archivo ZIP | `C:\SAPUI5\ZPERSONDOCS.zip` |
   | Paquete (prueba) | `$TMP` |
   | Paquete (final) | `ZHCC_PE` |

### Opción B — Deploy por CLI (requiere autorización ADT)

```bash
cd C:\SAPUI5
pnpm run deploy
```

> El CLI falló con HTTP 403. Requiere que Basis otorgue autorización ADT (`S_ADT_RES`) o acceso a `/sap/bc/adt/`.

---

## Verificación post-integración

Después de que ABAP entregue los endpoints y se reemplacen las funciones simuladas:

- [ ] La app carga en: `/sap/bc/ui5_ui5/sap/zpersondocs/index.html?sap-client=100`
- [ ] Al abrir, se resuelve el `PERNR` del usuario logueado vía SSO
- [ ] La tabla muestra los documentos agrupados por categoría
- [ ] El ícono del ojo solo aparece en filas con PDF disponible
- [ ] Al hacer clic en el ojo, abre el PDF en el dialog
- [ ] Al cerrar el dialog, el estado pasa a "Aprobado" en la tabla
- [ ] El botón "Volver a Successfactors" redirige a `https://hcm-br10.hr.cloud.sap/sf/start`
- [ ] No hay filtros de período (confirmado: no van en este formulario)

---

## Estructura de archivos relevantes

```
C:\SAPUI5\
├── webapp/
│   ├── controller/
│   │   ├── App.controller.js     ← Lógica principal + puntos [REEMPLAZAR ABAP]
│   │   └── BaseController.js     ← Helpers base
│   ├── view/
│   │   ├── App.view.xml          ← Vista principal (TreeTable + Panel)
│   │   └── ShowPDF.fragment.xml  ← Dialog visor de PDF
│   ├── css/
│   │   └── style.css             ← Estilos Yambal (naranja) + layout
│   └── model/
│       └── sample.pdf            ← PDF de prueba (solo simulación local)
├── ui5.yaml                      ← Configuración SAPUI5 tooling
├── ui5-deploy.yaml               ← Configuración deploy ABAP CLI
├── package.json                  ← Scripts y dependencias
└── ZPERSONDOCS.zip               ← ZIP listo para subir vía SE38
```

---

## Comandos locales

```bash
# Servidor de desarrollo
pnpm start
# → http://localhost:8080/index.html

# Build para producción
pnpm exec ui5 build

# Deploy CLI (requiere autorización ADT en el servidor)
pnpm run deploy
```
