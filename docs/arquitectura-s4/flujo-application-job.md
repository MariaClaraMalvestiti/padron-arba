# Flujo propuesto - Application Job ABAP

## Objetivo

Definir el comportamiento esperado del job ABAP que procesara una carga de padron ARBA en S/4HANA Cloud Public.

El job debe permitir que el procesamiento continue aunque el usuario cierre la aplicacion UI5.

## Entrada del job

El job recibe como parametro principal:

- UploadId

Con ese identificador lee la cabecera en ZPADRON_UPLOAD y los registros pendientes en ZPADRON_RECORD.

## Flujo general

1. Leer cabecera de carga por UploadId.
2. Cambiar estado de la carga a RUNNING.
3. Leer registros con estado PENDING.
4. Por cada registro:
   - Validar formato del CUIT.
   - Buscar cliente en S/4 por CUIT.
   - Si no existe cliente, marcar registro como ERROR o SKIPPED segun definicion funcional.
   - Si existe cliente, determinar si ya existe condition record para la clave y vigencia.
   - Si existe condition record, actualizarlo.
   - Si no existe condition record, crearlo.
   - Guardar resultado en ZPADRON_RECORD.
   - Guardar logs en ZPADRON_LOG.
5. Actualizar contadores de cabecera:
   - Total registros
   - Procesados
   - Creados
   - Actualizados
   - Errores
   - Omitidos
6. Al finalizar:
   - Si no hubo errores, marcar carga como DONE.
   - Si hubo errores parciales, marcar como DONE_WITH_ERRORS.
   - Si fallo el proceso general, marcar como FAILED.

## Logica de busqueda de cliente

El job debe resolver el Customer de S/4 a partir del CUIT del padron.

Dato de entrada:

- CUIT

Resultado esperado:

- Customer
- NombreCliente

Si el CUIT no corresponde a un cliente existente, el registro no debe intentar crear condition records.

## Logica de condition records

Datos conocidos para ARBA:

- Condition Table: 901
- Condition Type: Z902
- Country: AR
- Rate Unit: %
- Tax Code: SD

La clave exacta del condition record debe confirmarse con el funcional segun la access sequence configurada.

Regla propuesta:

- Si existe condition record para el cliente y misma vigencia, actualizar alicuota.
- Si no existe condition record para el cliente y vigencia, crear nuevo condition record.
- Si existe solapamiento de fechas, aplicar politica definida por funcional.

## Politicas funcionales pendientes

Antes de implementar escritura, se debe confirmar:

1. Access sequence exacta.
2. Campos clave del condition record.
3. Politica ante fechas solapadas.
4. Politica de baja.
5. Si se debe actualizar tambien BP Tax Grouping / Tax Classification.
6. Si la alicuota del TXT viene como porcentaje o requiere conversion.
7. Si registros con marca alta/baja N deben procesarse o ignorarse.

## Manejo de errores

Cada error debe quedar registrado con:

- UploadId
- RecordId si aplica
- Tipo de error
- Mensaje funcional
- Detalle tecnico

Ejemplos:

- CUIT invalido.
- Cliente no encontrado.
- Error al buscar condition record.
- Error al crear condition record.
- Error al actualizar condition record.
- Error de autorizacion.
- Error de datos obligatorios.

## Reintentos

El modelo deberia permitir reintentar:

- Toda la carga.
- Solo registros con error.

El reintento no debe duplicar condition records si ya fueron creados en una ejecucion anterior.

## Consideracion SAP Public Cloud

En S/4HANA Cloud Public no se deben actualizar tablas estandar directamente.

La escritura debe realizarse mediante objetos, APIs o mecanismos permitidos por SAP para Public Cloud.
