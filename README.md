# ZPERSONDOCS — Mis Documentos

Formulario SAPUI5 para que el colaborador vea sus documentos personales.
Se desarrolló siguiendo el mismo estándar de ZPAYDOC (Documentos de planilla),
que ya está deployado en el mismo servidor.

---

## Qué falta para que funcione en producción

El frontend está completo y funcionando con datos simulados. Lo único pendiente
es que ABAP exponga los 2 endpoints descritos abajo. Cuando estén listos, los
reemplazos en el código son directos — cada función simulada tiene el código real
comentado encima, solo hay que descomentar y ajustar el nombre del servicio.

---

## Datos del proyecto

| | |
|--|--|
| App BSP | `ZPERSONDOCS` |
| Namespace | `mis.documentos` |
| Paquete pruebas | `$TMP` |
| Paquete producción | `ZHCC_PE` |
| URL final | `https://<servidor>/sap/bc/ui5_ui5/sap/zpersondocs/index.html?sap-client=100` |

---

## Sobre los filtros de fecha

Este formulario no tiene buscador de fechas — fue confirmado así por BG/Luis.
La columna "Fecha de Emisión" sí aparece en la tabla pero es solo informativa;
el endpoint devuelve todos los documentos del colaborador de una sola vez.

---

## Endpoint 1 — ¿Quién está logueado?

Este ya existe en el servidor, es el mismo que usa ZPAYDOC.

```
GET /sap/bc/ui2/start_up
```

Respuesta esperada:
```json
{ "id": "10002345" }
```

El `id` es el PERNR del usuario con sesión activa. Si en lugar de JSON llega
HTML, la sesión expiró y el frontend recarga para ir al login.

**Función a reemplazar:** `getUserInfo()` — buscar `[REEMPLAZAR ABAP - EP1]`

---

## Endpoint 2 — Lista de documentos del colaborador

```
GET /sap/opu/odata/sap/<SERVICIO>/ZHRTInfotSet?$format=json&$filter=Pernr eq '<PERNR>'
```

El servicio lee de la tabla `ZHRT_INFOTRABAJA` y devuelve todos los documentos
del PERNR. Sin filtro de período.

Respuesta esperada:
```json
{
  "d": {
    "results": [
      {
        "PERNR":        "90000022",
        "IDGRUPO":      "01",
        "IDTIPODOC":    "01",
        "FECHA":        "2026-06-16",
        "VERDOCUMENTO": "",
        "DOCUMENTO":    "Compromiso de Adhesión",
        "ADJUNTO":      "<base64 del PDF>"
      }
    ]
  }
}
```

Campos que usa el frontend:

| Campo | Qué hace el frontend con él |
|-------|-----------------------------|
| `IDGRUPO` | Agrupa las filas (ver códigos abajo) |
| `IDTIPODOC` | Identifica el documento dentro del grupo |
| `FECHA` | Se muestra en la columna "Fecha de Emisión" |
| `VERDOCUMENTO` | `"X"` = Aprobado, `""` = Pendiente |
| `DOCUMENTO` | Nombre que aparece en la tabla |
| `ADJUNTO` | PDF en Base64 — si viene vacío, no muestra el ícono del ojo |

Grupos (`IDGRUPO`):

| Código | Nombre en pantalla |
|--------|--------------------|
| `01` | Código de Ética |
| `02` | Reglamentos y cargos |
| `03` | Autorizaciones/Compensaciones |
| `04` | Documentos Personales |
| `05` | Certificados de Trabajo, Estudios y Capacitaciones |
| `06` | Documentos de Familiares |
| `07` | Documentos de Ingreso |

**Funciones a reemplazar:** `_simulateGetDocuments()` y `_simulatePDFLoad()` — buscar `[REEMPLAZAR ABAP - EP2]`

### Ojo con el campo ADJUNTO

Al revisar la tabla `ZHRT_INFOTRABAJA` en el Data Browser encontramos que no todos
los registros tienen el mismo formato en ese campo:

- Los que empiezan con `JVBERi0x` son PDF en Base64 — estos sí funcionan con el visor
- Los que empiezan con `UEsDBBQ` son archivos ZIP o Word en Base64 — el visor no los puede abrir
- Uno venía en hexadecimal (`255044462D...`) en lugar de Base64 — tampoco funciona

El Data Browser trunca el campo en pantalla pero el contenido completo sí está en la BD
(lo confirmamos decodificando el fragmento visible del hexadecimal y salió el header `%PDF-1.7`).

Antes de publicar el servicio hay que confirmar dos cosas:
1. Que `ADJUNTO` siempre venga en **Base64** — no en hex ni en otros formatos
2. Que el campo `DOCUMENTO` venga con el nombre legible del documento — en los registros
   de prueba venía vacío, así que el frontend actualmente muestra el código `IDTIPODOC`

---

## Marcar documento como leído

Cuando el colaborador abre un PDF y cierra el visor, el frontend registra la lectura.
Es el mismo patrón que usa ZPAYDOC (función `UpdateFlag`).

Primero se captura el token CSRF:
```
GET /sap/opu/odata/sap/<SERVICIO>/ZHRTInfotSet(Pernr='...',Idtipodoc='...')
Header: X-CSRF-Token: fetch
```

Luego se envía el PATCH:
```
PATCH /sap/opu/odata/sap/<SERVICIO>/ZHRTInfotSet(Pernr='...',Idtipodoc='...')
Header: X-CSRF-Token: <token capturado>
Body:   { "Aceptlectura": "SI" }
```

**Función a reemplazar:** `_simulateMarkAsRead()` — buscar `[REEMPLAZAR ABAP - EP3 paso B]`

---

## Dónde hacer los reemplazos

Abrir `webapp/controller/App.controller.js` y buscar estas etiquetas:

| Etiqueta | Función | Endpoint |
|----------|---------|----------|
| `[REEMPLAZAR ABAP - EP1]` | `getUserInfo()` | GET /sap/bc/ui2/start_up |
| `[REEMPLAZAR ABAP - EP2]` | `_simulateGetDocuments()` | GET OData lista |
| `[REEMPLAZAR ABAP - EP2 / visor PDF]` | `_simulatePDFLoad()` | decode ADJUNTO |
| `[REEMPLAZAR ABAP - EP3 paso B]` | `_simulateMarkAsRead()` | CSRF + PATCH |

El código real de cada reemplazo está comentado justo encima de cada función.

---

## Deploy

### Build + ZIP

```bash
pnpm exec ui5 build
```
Comprimir la carpeta `dist/` como `ZPERSONDOCS.zip`.

### Subir a SAP

En SAP GUI abrir **SE38** o **SA38** y ejecutar el programa `/UI5/UI5_REPOSITORY_LOAD`.
Es un programa ABAP, no una transacción — no funciona escribiéndolo directo en el
campo de comandos.

Parámetros:
- App BSP: `ZPERSONDOCS`
- ZIP: `ZPERSONDOCS.zip`
- Paquete: `$TMP` para pruebas, `ZHCC_PE` para producción

Si prefieren el CLI (`pnpm run deploy`) necesitan autorización ADT — por ahora devuelve 403.

---

## Checklist post-integración

- [ ] La app abre y el usuario se identifica automáticamente por SSO
- [ ] La tabla muestra los documentos agrupados correctamente
- [ ] Las filas sin ADJUNTO no muestran el ícono del ojo
- [ ] Al abrir el visor se carga el PDF del campo ADJUNTO
- [ ] El botón "Volver a Successfactors" redirige correctamente
