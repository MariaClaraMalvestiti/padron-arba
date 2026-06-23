# Contrato OData propuesto - Padrones ARBA

## Objetivo

Definir los servicios que deberia exponer S/4HANA Cloud para que el frontend UI5 pueda cargar un padron, iniciar el procesamiento asincronico y consultar el resultado.

## Servicio propuesto

Nombre sugerido:

ZPADRON_ARBA_SRV

Tambien podria implementarse como servicio RAP, por ejemplo:

ZUI_PADRON_ARBA_O4

El nombre definitivo dependera de la convencion del cliente.

## Entidades principales

### UploadSet

Representa la cabecera de una carga de padron.

Campos sugeridos:

- UploadId
- Organismo
- NombreArchivo
- FechaCarga
- UsuarioCarga
- Estado
- TotalRegistros
- RegistrosProcesados
- RegistrosOk
- RegistrosError
- MensajeEstado
- JobName
- JobRunId

Estados posibles:

- DRAFT
- UPLOADED
- QUEUED
- RUNNING
- DONE
- DONE_WITH_ERRORS
- FAILED

### UploadRecord

Representa cada linea del padron.

Campos sugeridos:

- UploadId
- RecordId
- LineNumber
- CUIT
- Customer
- NombreCliente
- FechaDesde
- FechaHasta
- Alicuota
- MarcaAltaBaja
- MarcaCambioAlicuota
- AccionSugerida
- Estado
- MensajeError

Estados posibles:

- PENDING
- VALIDATED
- CREATED
- UPDATED
- SKIPPED
- ERROR

### UploadLog

Representa eventos tecnicos y funcionales del procesamiento.

Campos sugeridos:

- UploadId
- LogId
- FechaHora
- Tipo
- Mensaje
- DetalleTecnico

Tipos posibles:

- INFO
- WARNING
- ERROR
- TECHNICAL

## Operaciones del servicio

### Crear carga

Operacion:

POST UploadSet

Uso:

El frontend crea una nueva carga de padron con los datos generales del archivo.

Resultado esperado:

Devuelve un UploadId.

### Subir contenido del padron

Operacion sugerida:

Action UploadContent

Entrada:

- UploadId
- FileName
- ContentBase64

Uso:

El frontend envia el archivo TXT codificado en base64.

Resultado esperado:

El backend guarda el archivo o parsea las lineas y deja la carga en estado UPLOADED.

### Iniciar procesamiento

Operacion sugerida:

Action StartProcessing

Entrada:

- UploadId

Uso:

El frontend solicita iniciar el procesamiento del padron.

Resultado esperado:

El backend dispara un Application Job ABAP y devuelve estado QUEUED.

### Consultar estado

Operacion:

GET UploadSet(UploadId)

Uso:

El frontend consulta periodicamente el estado de la carga.

Resultado esperado:

Devuelve estado, totales, avance y mensaje general.

### Consultar registros

Operacion:

GET UploadSet(UploadId)/to_Records

Uso:

El frontend muestra registros con error o detalle tecnico, si corresponde.

Recomendacion:

Por defecto mostrar solo resumen. El detalle de registros deberia quedar disponible para usuarios tecnicos o mediante una accion de "ver detalle".

### Consultar logs

Operacion:

GET UploadSet(UploadId)/to_Logs

Uso:

El frontend consulta mensajes del proceso, errores y trazabilidad.

## Flujo esperado desde el frontend

1. Usuario selecciona archivo TXT.
2. Frontend crea UploadSet.
3. Frontend envia contenido con UploadContent.
4. Frontend llama StartProcessing.
5. Frontend muestra estado QUEUED/RUNNING.
6. Si el usuario cierra la pestaña, el job continua en S/4.
7. Al volver, el usuario consulta UploadSet y ve estado final.
8. Si hay errores, consulta registros/logs.

## Consideraciones

- El frontend no debe procesar reglas de negocio complejas.
- La validacion de CUIT y la decision de crear/modificar debe vivir en ABAP.
- La escritura en S/4 debe hacerse desde objetos o APIs permitidas para S/4HANA Cloud Public.
- El detalle masivo de registros no deberia mostrarse por defecto al usuario final.
- El servicio debe permitir trazabilidad y reintento de errores.
