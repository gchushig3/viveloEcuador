# Análisis arquitectónico: extracción de Booking

Fecha de análisis: 6 de noviembre de 2026. **Propuesta pendiente de validación;
no se ha iniciado la extracción ni se ha consultado el estado de Azure.** Este
documento describe el código del monorepo, no garantiza que coincida con lo
que está desplegado.

## Alcance y separación de flujos

Hay dos flujos distintos que comparten Inventory, pero no la misma persistencia
ni el mismo ciclo de vida:

1. **Reserva B2B de atracciones**: implementada en Catalog para el contrato de
   Booking externo. Crea y cancela en `reserva_atraccion` y llama a Inventory
   por gRPC. Es el objeto de esta propuesta.
2. **Compra web de Cart**: Cart crea sus propias reservas y coordina inventario,
   pago y reembolso mediante eventos de saga. El checkout y «Mis reservas»
   actuales usan este flujo. No debe trasladarse ni sustituirse por el anterior.

Fuentes: [BookingReservationsService](services/ms-catalog/src/booking/booking-reservations.service.ts),
[CartService frontend](apps/booking-web/src/app/services/cart.service.ts),
[contrato de saga](packages/shared-infrastructure/src/saga/contracts.ts) y
[pruebas integradas](tests/integration/saga/integration.mjs).

## Inventario real

| Elemento | Situación observada | Tratamiento propuesto |
| --- | --- | --- |
| Creación y cancelación | [BookingReservationsService](services/ms-catalog/src/booking/booking-reservations.service.ts) registra `PENDIENTE`, reserva por gRPC y confirma; cancela pasando por `CANCELANDO` y liberación idempotente. | Extraer su comportamiento, conservar UUID, clave, hash, estados, respuestas y recuperación. |
| HTTP B2B | [BookingContractController](services/ms-catalog/src/modules/attractions/booking-contract.controller.ts) mezcla creación y cancelación con disponibilidad, promociones y salud. Sus operaciones de reserva son públicas. | Separar solo reserva/cancelación; disponibilidad y catálogo permanecen en Catalog. Mantener rutas externas mediante adaptación temporal. |
| HTTP administrativo | [AdminReservationsController](services/ms-catalog/src/modules/attractions/admin-reservations.controller.ts) lista, filtra, pagina, obtiene y cancela reservas; `resumen` mezcla reservas y atracciones. | Extraer consultas y cancelación; diseñar composición explícita del resumen sin cambiar su forma. |
| Catálogo para Booking | [BookingCatalogService](services/ms-catalog/src/booking/booking-catalog.service.ts) consulta atracciones, fotos, categorías, idiomas, perfil y disponibilidad. | Permanece en Catalog. El nombre `booking` no implica que todo su contenido deba moverse. |
| Perfil y proyección | [BookingProfileEntity](services/ms-catalog/src/booking/booking-profile.entity.ts), `booking_attraction_profile` y `resena_proyeccion` son proyecciones de catálogo, no reservas. | Mantener en Catalog junto con publicaciones de atracciones y reseñas. |
| Cliente de Inventory | [InventoryAdminService](services/ms-catalog/src/booking/inventory-admin.service.ts) combina RPC de reserva y cancelación con administración de cupos. | Crear adaptador propio en Booking para `ReserveBooking` y `ReleaseBooking`; mantener en Catalog los RPC administrativos y consulta de disponibilidad. No mover Inventory. |
| Historial | No se observó una tabla o endpoint de historial de cambios de la reserva B2B; existe `res_creada_en` y estado actual. | No afirmar ni inventar historial preexistente. Diseñar registro de cambios como evolución posterior si se aprueba. |
| Entidades | Reservas usan SQL directo, no una entidad TypeORM de reserva. `BookingProfileEntity` representa perfil de atracción. | Crear modelo de dominio de reserva a partir del comportamiento real, sin trasladar la entidad de perfil. |

[AttractionsModule](services/ms-catalog/src/modules/attractions/attractions.module.ts)
registra conjuntamente los controladores y servicios. El
[arranque HTTP](services/ms-catalog/src/configure-application.ts) reescribe
`/api/v3/` a `/api/v2/`, de modo que no son implementaciones independientes:
hay que preservar métodos, rutas, cuerpos, cabeceras y respuestas en ambas.

## Dependencias

```text
Booking externo -- HTTP /api/v2 y /api/v3 --> Catalog
  Catalog: controlador B2B --> reserva_atraccion -- FK/JOIN --> atraccion
                          --> InventoryAdminService -- gRPC --> Inventory
  Panel ADMIN --> Catalog admin --> Identity (introspección)
                              --> reserva_atraccion + atraccion
Checkout web --> Cart --> eventos saga --> Inventory y Payment --> Refund
Catalog --> evento atraccion.consultada; Review --> RESENA_PUBLICADA --> Catalog
```

- **Catalog**: el alta exige una atracción `PUBLICADA`, no eliminada, consultada
  por UUID o ID numérico. La reserva guarda `atr_id`; las respuestas y el panel
  hacen `JOIN` para obtener nombre y UUID. La búsqueda administrativa incluye
  nombre de atracción; el resumen combina contadores y top de atracciones.
  Es una dependencia de datos y de semántica, no solo una importación.
- **Inventory**: el [proto](contracts/grpc/inventory.proto) define
  `InventoryAdminService.ReserveBooking` y `ReleaseBooking`, con `x-api-key`.
  La tabla `booking_inventory_allocation` es propiedad de Inventory; protege
  idempotencia, aforo y liberación. El mismo Inventory atiende Cart y Booking.
  La consulta de disponibilidad usa `InventoryStockService.GetSlotAvailability`.
- **Identity**: el [guard de Catalog](services/ms-catalog/src/common/guards/administrative-access.guard.ts)
  consulta `/auth/booking/introspect` con API key; comprueba sesión y exige
  `ADMIN` en operaciones no públicas. El contrato B2B de creación y cancelación
  usa `@PublicEndpoint`; cambiar esa política requiere una decisión explícita.
- **Cart**: no se observó llamada directa de Booking B2B a Cart. Compiten por
  los mismos cupos y hay pruebas de competencia entre ambos. No debe cambiarse
  el contrato ni el almacenamiento de Cart.
- **Payment**: no se observó llamada directa ni emisión de eventos de pago en
  la creación/cancelación B2B; Payment participa en la saga de Cart. No atribuir
  cobros ni reembolsos B2B a este flujo.
- **Audit**: no se observó emisión directa de eventos de auditoría desde
  `BookingReservationsService`; no se debe asumir una auditoría de reservas B2B.
- **Gateway**: `apps/gateway` está vacío y no hay `services/ms_booking`. El
  gateway y la ruta `/api/v1/booking/*` son trabajo futuro, no infraestructura
  actualmente disponible.

## Persistencia y contratos

`reserva_atraccion` se crea en el inicio de
[BookingContractController](services/ms-catalog/src/modules/attractions/booking-contract.controller.ts),
con FK a `atraccion`; después añade clave y hash de idempotencia y un índice
único parcial por clave. El DDL mostrado no declara unicidad para `res_uuid`:
antes de añadir una restricción se debe verificar la base real y sus duplicados.
La base en Azure no fue inspeccionada. No asumir que este DDL coincide con su
esquema efectivo; véase [plan de migración](DATABASE_MIGRATION_PLAN.md).

El contrato externo es [OpenAPI Atracciones v3](contracts/openapi/atracciones-openapi-v3.yaml).
Incluye reserva, cancelación, disponibilidad, detalle y check-in, entre otros.
Que una operación aparezca en OpenAPI no demuestra que esté implementada:
el controlador B2B observado implementa creación y cancelación, no un endpoint
de detalle o check-in B2B. Conservar el contrato original y hacer una matriz
operación por operación antes de separar especificaciones.

## Eventos: estado y diseño

La reserva B2B observada no publica `BookingCreated`, `BookingConfirmed`,
`BookingCancelled` ni `BookingFailed`. Catalog publica `atraccion.consultada`
y consume `RESENA_PUBLICADA`; pertenecen al catálogo/proyección. La saga de
Cart utiliza `reserva.creada`, `inventario.reservado`, `pago.procesado`,
`pago.fallido`, `pago.reembolsado` y otros. Su validador restringe orígenes y
esquema; **no aceptar automáticamente `ms_booking` en esa saga**.

Propuesta para una versión futura, sujeta a aprobación: eventos
`booking.created`, `booking.confirmed`, `booking.cancelled` y `booking.failed`,
respectivamente equivalentes a los nombres solicitados `BookingCreated`,
`BookingConfirmed`, `BookingCancelled` y `BookingFailed`. Usar el sobre del
proyecto `eventoId`, `tipo`, `fechaISO`, `origen`, `correlationId`, `data`;
especificar versión, claves de enrutamiento, significado, orden por reserva,
consumidores y datos mínimos sin nombre/correo. `booking.failed` no debe
inventar un estado persistido ni confundir una respuesta incierta con fallo
definitivo. Registrar evento y transición mediante outbox transaccional, publicar
con confirmación y consumidores idempotentes; no activar eventos sin acordar
contratos, migración y consumidores.

## Diseño propuesto para `services/ms_booking`

```text
src/
  domain/           estados, invariantes y puertos de repositorio
  application/      casos de uso de reserva, cancelación y consulta
  infrastructure/   adaptadores PostgreSQL, Inventory, Identity y outbox
  interfaces/       contratos de entrada/salida y mapeo de errores
  controllers/      HTTP B2B y administrativo, sin reglas de dominio
  grpc/             cliente y mapeo del contrato Inventory existente
  events/           contratos y publicación futura mediante outbox
  dto/              validación HTTP compatible con v2/v3
  database/         migraciones versionadas y consultas de Booking
```

Las dependencias apuntan hacia `domain`/`application`; adaptadores implementan
puertos. Catalog mantiene atracciones, categorías, disponibilidad y perfil.
No se introducirá acceso cruzado permanente a la base de Catalog: hace falta
un contrato de lectura/proyección de atracciones con semántica acordada.
El resumen mixto requerirá composición en Catalog/BFF/gateway o un contrato
agregado explícito; aún no existe decisión implementada.

## Incertidumbres que bloquean la implementación

- Estado real del esquema y datos, duplicados, reservas sin asignación en
  Inventory y permiso de DDL en producción.
- Capacidad de introducir un corte breve de escrituras; sin corte se necesita
  una captura de cambios ordenada, probada y autorizada.
- Política de autenticación del B2B, propietarios y ruta de transición del ESB.
- Semántica actual frente a futura del nombre de atracción tras editarla,
  eliminarla o cambiar su estado; una instantánea no equivale al `JOIN` actual.
- Destino de composición del resumen administrativo y garantía de paginación.
- Estado real del gateway, despliegues y contratos con consumidores externos.

La decisión y el orden propuestos están en
[BOOKING_EXTRACTION_ROADMAP.md](BOOKING_EXTRACTION_ROADMAP.md); impacto web en
[FRONTEND_IMPACT.md](FRONTEND_IMPACT.md).
