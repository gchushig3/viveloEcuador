# Pruebas unitarias de controllers

Las 13 suites de controllers de dominio usan `Test.createTestingModule()` de
`@nestjs/testing`, `controllers: [Controller]`, proveedores simulados con
`{ provide: Service, useValue: serviceMock }` y `module.get(Controller)`.
Cada caso prepara sus datos, ejecuta un método y comprueba la respuesta,
los argumentos enviados al servicio o el error esperado. Se cierra el módulo
después de cada caso para liberar sus recursos.

Se conservan las herramientas existentes: Jest, Vitest y Node Test Runner.
`ms-cliente` y `ms_inventory` tienen `@nestjs/testing` como dependencia de desarrollo;
sus pruebas JavaScript importan el código TypeScript compilado.

## Ejecutar desde la raíz

Con las dependencias instaladas en cada microservicio:

```powershell
node scripts/test-controllers.mjs
```

Para ejecutar uno o varios servicios:

```powershell
node scripts/test-controllers.mjs ms_refund
node scripts/test-controllers.mjs ms-catalog ms_cart ms_inventory
```

El script ejecuta las suites de forma secuencial, informa el resultado de cada
servicio y termina con código distinto de cero si alguna falla. Puede utilizarse
como paso de un pipeline de CI. No instala dependencias ni conecta PostgreSQL,
RabbitMQ, Booking u otros servicios externos.

## Ubicación y alcance

Las rutas de esta tabla son relativas a la carpeta de cada microservicio:

| Microservicio      | Archivo                                                          | Casos principales                                                                                  |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ms-catalog         | `test/unit/attractions.controller.spec.ts`                       | Conversión y rechazo de filtros, correlación, detalle, evento de consulta, cambios administrativos |
| ms-cliente         | `test/clients.controller.test.mjs`                               | Consulta, normalización, cliente existente, origen Booking/Tienda, paginación e IDs                |
| ms_audit           | `src/audit/audit.controller.spec.ts`                             | Filtros de eventos, consultas vacías y propagación de errores                                      |
| ms_billing_profile | `src/dato-facturacion/dato-facturacion.controller.spec.ts`       | Usuario autenticado, CRUD y encabezado Location                                                    |
| ms_cart            | `src/cart/cart.controller.spec.ts`                               | Compra, idempotencia, usuario, cancelación y errores de plazo                                      |
| ms_coupon          | `src/cupon/cupon.controller.spec.ts`                             | Consultas, validación por fecha, actualización, eliminación y errores                              |
| ms_identity        | `test/unit/auth.controller.spec.ts`                              | Registro, login, datos del navegador, tokens, recuperación, sesiones y contraseñas                 |
| ms_inventory       | `test/inventory.controller.test.mjs`                             | Disponibilidad, clave gRPC, reserva/liberación, turnos HTTP y procesamiento de streams             |
| ms_location        | `src/attraction-location/attraction-location.controller.spec.ts` | Ubicación, coordenadas, IDs BIGINT y errores                                                       |
| ms_payment         | `src/pago/pago.controller.spec.ts`                               | Creación/reintento, estado y Location, consultas, simulación y conflictos                          |
| ms_refund          | `src/refund/refund.controller.spec.ts`                           | Solicitud del monto completo, listado y conflictos                                                 |
| ms_review          | `src/resena/resena.controller.spec.ts`                           | Reseñas visibles, usuario autenticado, creación/Location y visibilidad                             |
| ms_support         | `src/mensaje/mensaje.controller.spec.ts`                         | Creación/Location, filtro leído, consulta, marcado, eliminación y errores                          |

## Qué comprueban estas pruebas

Estas suites invocan directamente los métodos de los controllers y simulan sus
servicios. Comprueban la lógica del controller y su comunicación con el servicio.
No validan la lógica interna de los servicios simulados ni representan cobertura
completa de todos los controllers de cada microservicio.

Los guards, los pipes aplicados mediante decoradores, los códigos HTTP y las rutas
deben verificarse con las pruebas HTTP/e2e existentes. Por ejemplo, la prueba del
controller de carrito verifica que se propague un conflicto por las 24 horas;
las pruebas unitarias de `CartService` y `BookingReservationsService` comprueban
el cálculo real de ese plazo.

Referencia: [NestJS Testing](https://docs.nestjs.com/fundamentals/testing).

## Validación realizada

El ejecutor de controllers valida **13 suites y 74 casos**. Todas pasan.
Las nuevas suites también pasan la comprobación de tipos. La comprobación global
de tipos de `ms_coupon` y `ms_location` detecta errores previos en las pruebas de
servicio (`cupon.service.spec.ts`, `ciudad.service.spec.ts` y
`provincia.service.spec.ts`): sus datos simulados no incluyen todos los campos o
usan tipos que ya no coinciden con las entidades. Esto es independiente de las
nuevas pruebas de controller.
