# Modelo de tablas custom propuesto - Padrones ARBA

## Objetivo

Definir una estructura de persistencia en S/4HANA Cloud para guardar cargas de padron, registros parseados y logs de procesamiento.

Estas tablas permiten que el proceso sea asincronico, auditable y consultable aunque el usuario cierre la aplicacion.

## Tabla 1: ZPADRON_UPLOAD

Cabecera de cada carga de padron.

Campos sugeridos:

- MANDT
- UPLOAD_ID
- ORGANISMO
- NOMBRE_ARCHIVO
- FECHA_CARGA
- HORA_CARGA
- USUARIO_CARGA
- ESTADO
- TOTAL_REGISTROS
- REGISTROS_PROCESADOS
- REGISTROS_OK
- REGISTROS_ERROR
- MENSAJE_ESTADO
- JOB_NAME
- JOB_RUN_ID
- CREATED_AT
- CREATED_BY
- CHANGED_AT
- CHANGED_BY

Estados sugeridos:

- DRAFT
- UPLOADED
- QUEUED
- RUNNING
- DONE
- DONE_WITH_ERRORS
- FAILED

## Tabla 2: ZPADRON_RECORD

Detalle de registros del padron.

Campos sugeridos:

- MANDT
- UPLOAD_ID
- RECORD_ID
- LINE_NUMBER
- CUIT
- CUSTOMER
- NOMBRE_CLIENTE
- FECHA_PUBLICACION
- FECHA_DESDE
- FECHA_HASTA
- ALICUOTA
- TIPO_CONTRIBUYENTE
- MARCA_ALTA_BAJA
- MARCA_CAMBIO_ALICUOTA
- GRUPO
- CONDITION_RECORD
- ACCION_SUGERIDA
- ESTADO
- MENSAJE_ERROR
- CREATED_AT
- CHANGED_AT

Estados sugeridos:

- PENDING
- VALIDATED
- CREATED
- UPDATED
- SKIPPED
- ERROR

Acciones sugeridas:

- CREATE
- UPDATE
- SKIP
- ERROR

## Tabla 3: ZPADRON_LOG

Log tecnico y funcional del procesamiento.

Campos sugeridos:

- MANDT
- UPLOAD_ID
- LOG_ID
- RECORD_ID
- FECHA_HORA
- TIPO
- MENSAJE
- DETALLE_TECNICO

Tipos sugeridos:

- INFO
- WARNING
- ERROR
- TECHNICAL

## Relacion entre tablas

ZPADRON_UPLOAD 1..n ZPADRON_RECORD

ZPADRON_UPLOAD 1..n ZPADRON_LOG

ZPADRON_RECORD 1..n ZPADRON_LOG opcional, cuando el log corresponde a una linea especifica.

## Recomendaciones

- No mostrar todos los registros al usuario final por defecto.
- Mostrar resumen general y solo errores relevantes.
- Mantener logs tecnicos para soporte.
- Permitir reintento de registros con estado ERROR.
- Guardar JobName y JobRunId para trazabilidad con Application Jobs.
- Guardar Condition Record resultante cuando se cree o modifique una condicion.
