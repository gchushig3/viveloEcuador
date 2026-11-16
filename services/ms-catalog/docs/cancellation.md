# Cancelación y restitución de cupos

Booking puede llamar `POST /api/v3/atracciones/reservas/:id/cancel` o el alias
`POST /api/v3/reservas/:id/cancel`. Se conservan las rutas equivalentes de v2.
El identificador admite el UUID/código que devuelve la creación de reserva y el ID numérico local.
El cuerpo es opcional: `{ "reason": "Solicitud del cliente" }`.
Se admiten `Idempotency-Key` y `X-Correlation-Id` opcionales.

La cancelación y el reembolso solo se pueden solicitar **con al menos 24 horas
de anticipación al turno reservado**, usando su fecha y hora en America/Guayaquil
(UTC-05:00). Exactamente 24 horas antes se permite cancelar. Con menos anticipación
o una fecha pasada, el backend responde 409 con título `Cancelación Fuera de Plazo`,
sin solicitar un reembolso ni liberar cupos. La fecha de compra no determina el plazo.
Mis reservas oculta el botón y el modal automáticamente cuando vence el plazo y
muestra la política de cancelación. Todos los turnos de una reserva deben cumplir
el límite; no se admiten cancelaciones parciales. Las cancelaciones ya aceptadas pueden terminar
su procesamiento y las canceladas conservan su respuesta idempotente.

La respuesta 200 conserva `reserva_id` y `estado: CANCELADA`, y añade
`status: CANCELLED`, `cancel_code`, `reembolso_id`, `monto_reembolsado`,
`refund` y `stock_restoration`. El código simulado es `REF-ATR-<res_uuid>`.
El recibo solo anuncia restitución después de que Inventory confirma la liberación.
Repetir la cancelación no libera cupos nuevamente. Si falla el RPC se conserva
`CANCELANDO` y la misma petición puede reintentarse; Inventory mantiene su registro
idempotente de asignaciones. El proceso de sincronización de stock existente publica
el cambio a Booking.

Una fecha de check-in existente o los estados `CHECKED_IN`, `CONFIRMADO_ASISTIDO`
y `COMPLETED` bloquean la cancelación antes de modificar el estado o llamar a Inventory:

```json
{
  "title": "Cancelación No Permitida",
  "detail": "No se puede cancelar una reserva que ya realizó check-in o fue asistida.",
  "status": 409
}
```

El filtro HTTP añade los campos de Problem Details existentes.

## Monto simulado de Booking

`reserva_atraccion` no guarda el total cobrado ni un desglose de pasajeros.
Sin cambiar tablas, este flujo calcula **tarifa actual de adulto × res_personas**
en la moneda del perfil. No es una devolución monetaria ni un registro en `reembolso`.
La tarifa puede variar entre reintentos si el perfil se edita. Si no existe tarifa,
se devuelve 409 sin iniciar una nueva cancelación. Para devolver y repetir el monto
histórico exacto se necesita acordar su origen y persistencia; no se inventa ese dato.

## Reservas de la web

Se conserva `POST /api/v2/cart/reservations/:id/cancel` y su respuesta asíncrona 202.
El importe es el original de `payload.amountCents`. Se conserva el servicio
`ms_refund` y su saga; las respuestas 409 de ese servicio ya no se interpretan como éxito.

Las consultas existentes de reservas (`GET` individual y listado del propietario)
añaden `cancellation`, con el comprobante y el progreso. Se guarda en la tabla
**existente** `saga_http_request`; no se agregan tablas ni columnas.
`pago.reembolsado` confirma el reembolso e `inventario_liberado` confirma los cupos,
en cualquier orden. Solo después de ambos eventos se muestra éxito en el modal.
El usuario puede volver a abrir el comprobante al consultar sus reservas.

La página de administración actualiza el stock cada 3 segundos. La web también
notifica el cambio de disponibilidad local cuando termina la cancelación.

## Asistencia

Cinco boletos con cuatro asistentes permiten check-in de cuatro; no generan
reembolso parcial ni liberación de un cupo. El check-in registrado bloquea la
cancelación de la reserva completa. Para siete asistentes con cinco boletos,
se rechaza el exceso y se indica comprar dos boletos en una nueva reserva,
sujeta a disponibilidad. Se conservan el estado interno y el contrato de check-in.

## Prueba manual integrada

1. Abrir la disponibilidad administrativa de una atracción y su turno.
2. Comprar cinco boletos desde Booking o la web y observar el descuento.
3. Cancelar la reserva completa y observar la restitución de cinco cupos.
4. Repetir la cancelación; el stock debe permanecer igual.
5. Crear otra reserva de cinco y registrar cuatro asistentes. La cancelación debe
   responder 409 y el stock no debe aumentar.
6. Intentar registrar siete asistentes con cinco boletos: debe solicitarse una
   compra independiente de los dos adicionales.
