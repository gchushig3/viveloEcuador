# Descubre EC

Monorepo de la plataforma de reservas, su frontend y sus microservicios.

## Estructura

- `apps/booking-web`: aplicación web Angular y sus pruebas E2E.
- `apps/bff`: destino reservado.
- `apps/gateway`: API Gateway NestJS para enrutamiento, JWT/RBAC, health checks y observabilidad; consulta [su guía](apps/gateway/README.md).
- `services/`: servicios NestJS, cada uno con sus propios scripts, dependencias, pruebas y configuración Docker.
- `packages/shared-infrastructure`: infraestructura compartida de saga, RabbitMQ, gRPC y validación.
- `contracts/`: contratos OpenAPI y Protocol Buffers.
- `tests/integration/saga`: pruebas integradas de flujos y broker.
- `infrastructure/`: SQL común, despliegue de Azure y futura configuración Compose.
- `docs/development` y `docs/operations`: guías de desarrollo e informes operativos.

Cada servicio y el frontend conservan su propio `package.json`; instala y ejecuta comandos desde el directorio correspondiente. No se requiere un workspace npm raíz.

## Contenedores locales después de mover archivos

Los contenedores creados antes de reorganizar el repositorio conservan sus rutas
de montaje anteriores. `docker compose start` no las actualiza: desde el
directorio actual del servicio, recrea el contenedor con `docker compose up`.
Por ejemplo, para PostgreSQL de pruebas de Identity:

```powershell
cd services/ms_identity
docker compose --env-file .env.test -f compose.test.yaml up -d --force-recreate --wait postgres
```

Consulta el README de cada servicio para sus archivos Compose y variables de
entorno. Verifica los nombres de proyecto y volúmenes antes de recrear otros
servicios: cambiar el nombre del proyecto puede seleccionar un volumen distinto.
No uses `down -v` para esta recuperación: elimina los volúmenes del proyecto.
Los scripts de inicialización de PostgreSQL solo se ejecutan con un volumen nuevo.

Los microservicios NestJS usan PostgreSQL, Inventory por gRPC y eventos de saga por AMQPS. Cada servicio tiene sus propios scripts de compilación y pruebas en `services/<servicio>/package.json`.

## Cambios de administraci?n y Booking

- Identity: `POST /api/v2/users/administrators`, exclusivo ADMIN, crea la cuenta y su rol de forma at?mica. Reutiliza las validaciones de registro y verifica la sesi?n dentro de la transacci?n. No promueve ni sustituye cuentas existentes.
- Cart: `GET /api/v2/cart/admin/reservations`, exclusivo ADMIN, consulta las ?ltimas 100 reservas de todos los clientes.
- Booking: `POST /api/v3/atracciones/reservas` descuenta cupos en el mismo Inventory utilizado por el carrito. Env?a un `Idempotency-Key` estable, entre 8 y 128 caracteres alfanum?ricos, guiones o guiones bajos, para recuperar respuestas perdidas sin duplicar reservas. Reutilizarlo con otros datos devuelve 409. Se conserva compatibilidad v2.
- Cancelar desde Booking o su panel libera los cupos una sola vez. PENDIENTE y CANCELANDO conservan operaciones que necesitan reintento tras una interrupci?n; ADMIN puede consultarlas y reintentar su cancelaci?n.
- Los RPC internos nuevos `ReserveBooking` y `ReleaseBooking` exigen la clave de sincronizaci?n de Inventory. No modifican las operaciones p?blicas de sincronizaci?n del proto.

## Pruebas integradas aisladas

Se requiere Node 24, Docker y las dependencias de cada servicio. La infraestructura compartida se versionó como 0.3.2 para evitar que npm conserve contratos antiguos. Desde `packages/shared-infrastructure`, ejecuta `npm.cmd ci` y `npm.cmd run build`; luego instala las dependencias de los servicios con `npm.cmd ci`. La suite integrada detecta copias desactualizadas.

Desde `services/ms_identity`, `services/ms_cart`, `services/ms_payment`, `services/ms_inventory` y `services/ms-catalog`, ejecuta `npm.cmd run build`. Desde la raíz:

```powershell
node --test tests/integration/saga/integration.mjs
node --test tests/integration/saga/broker.integration.mjs
```

La primera suite usa PostgreSQL 16 temporal, HTTP y gRPC reales. Identity/Catalog se simulan para las consultas auxiliares del carrito y los eventos de saga se entregan con una bomba de pruebas, incluyendo entregas duplicadas. Las altas ADMIN usan Identity y PostgreSQL reales; Booking usa su controlador HTTP v3, su servicio y su propio PostgreSQL real conectado a Inventory por gRPC.

La segunda suite usa RabbitMQ temporal sobre TLS y comprueba rutas, mensajes persistentes, redelivery y dead letter. Requiere la imagen `rabbitmq:3-management`, OpenSSL (variable opcional `OPENSSL_PATH`) y `tls.setDefaultCACertificates` de Node 24. Los certificados y contenedores de prueba se eliminan al terminar. No utiliza colas ni credenciales de producci?n.

Antes de desplegar, publica Inventory con el proto nuevo y después Catalog; la tabla aditiva `booking_inventory_allocation` se prepara al iniciar Inventory y está también declarada en `services/ms_inventory/database/saga.sql`. Catalog prepara las columnas e índice de idempotencia en su inicialización. Se requieren los permisos DDL correspondientes, sin cambiar los datos existentes.

El ESB externo de Booking no est? implementado en este repositorio. Las pruebas locales validan su contrato de entrada; no acreditan el recorrido por su infraestructura remota. Los pagos siguen siendo simulados. No se ejecut? despliegue remoto.
