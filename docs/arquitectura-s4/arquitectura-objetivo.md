# Arquitectura objetivo - Carga de Padrones en S/4HANA Cloud Public

## Objetivo

Replantear la solucion para que sea mas compatible con S/4HANA Cloud Public Edition, moviendo la logica principal de procesamiento al backend ABAP de S/4 y dejando el frontend UI5 como interfaz de carga, seguimiento y consulta.

## Arquitectura propuesta

Frontend UI5/Fiori -> Servicio OData custom en S/4 -> Application Job ABAP -> Actualizacion funcional en S/4

## Componentes

### Frontend UI5/Fiori

Responsable de:
- Permitir al usuario cargar el archivo TXT del padron.
- Enviar la carga al servicio OData de S/4.
- Mostrar estado de procesamiento.
- Mostrar resumen de resultados.
- Mostrar errores o registros rechazados.
- No ejecutar logica pesada de negocio.

### Servicio OData en S/4

Responsable de:
- Recibir el archivo o los registros del padron.
- Crear una cabecera de carga.
- Guardar los registros en tablas custom.
- Disparar un Application Job ABAP.
- Exponer endpoints para consultar estado, resumen y detalle.

### Application Job ABAP

Responsable de:
- Procesar el padron en segundo plano.
- Continuar aunque el usuario cierre la pestaña.
- Validar clientes por CUIT.
- Determinar si corresponde crear o actualizar.
- Aplicar la actualizacion funcional correspondiente.

### Actualizacion funcional

Segun definicion funcional del cliente, el job ABAP debera ejecutar uno de estos modelos:

1. Actualizacion BP Tax Grouping / Tax Classification.
2. Creacion o actualizacion de Pricing Condition Records.

Para este padron se debe confirmar el modelo definitivo antes de implementar escritura.

## Datos conocidos del padron ARBA

- Condition Table: 901
- Condition Type: Z902
- Pais: AR
- Unidad de alicuota: %
- Tax Code: SD

## Estado actual del proyecto

Actualmente existe un prototipo UI5 + backend Node.js que:
- Se conecta a destinos de BTP.
- Consulta Business Partners.
- Consulta Condition Records.
- Permite hacer preview del padron.
- No deberia considerarse arquitectura productiva final.

La nueva arquitectura debe reemplazar el backend Node.js por un servicio OData y job ABAP en S/4HANA Cloud.
