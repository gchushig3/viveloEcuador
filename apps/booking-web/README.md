# Frontend Angular ? Descubre EC

`npm.cmd ci`, `npm.cmd start`, `npm.cmd run build` y `npm.cmd test -- --watch=false`.

Desarrollo: http://localhost:4200. Las URLs se definen en `src/environments/`:

- Identity local: `http://localhost:3011/api/v2`.
- Catalog local: `http://localhost:3014/api/v2`.
- Cart local: `http://localhost:3000/api/v2` (puerto predeterminado de ms_cart).
- Producci?n conserva las direcciones configuradas de Azure y `/catalog-api`; este ?ltimo requiere el proxy del hosting.

El flujo actual de compra usa Cart v2, Inventory gRPC y la saga de pagos. Los datos de tarjeta se validan en el navegador; el servicio de pagos es simulado. Las rutas v1 y sus pruebas antiguas se conservan como antecedentes, no como evidencia del flujo v2.

El panel permite crear administradores con `POST /users/administrators`, administrar roles, crear/editar atracciones y sus cupos, consultar las ?ltimas 100 reservas del carrito y gestionar las reservas de Booking. El resumen num?rico de reservas corresponde a Booking; la secci?n Reservas identifica ambos or?genes.

Checkout conserva la clave de idempotencia al reintentar dentro de la pantalla. Las reservas confirmadas muestran un QR local con su identificador. El QR no realiza check-in. La cancelaci?n pide confirmaci?n y consulta el resultado de la saga de reembolso; al salir de la pantalla se detiene la consulta.

## Verificaci?n

- `npm.cmd test -- --watch=false`: pruebas Angular de contratos, componentes, rutas y servicios.
- `npm.cmd run build`: build de producci?n.
- `npm.cmd run test:admin-v2`: Chrome sin interfaz, escritorio de 1440 px y m?vil de 390 px. Requiere primero el build y Chrome instalado. Usa respuestas HTTP controladas; no modifica cuentas reales.
- Las pruebas reales de base de datos, HTTP, gRPC, cupos, pagos, reembolsos y AMQPS est?n en `../services/saga-tests/`.

No se public? ni se cambi? la configuraci?n de servicios remotos. Revisa `../VALIDACION-ADMIN-BOOKING.md` para el alcance y los resultados.

## Panel: reservas, clientes y saga

El resumen suma los contadores completos de Booking y Cart (no solo sus ultimas
100 reservas). Presenta las cinco reservas mas recientes entre ambos canales,
con su origen. El ranking de atracciones se identifica explicitamente como Booking.
Resumen y reservas consultan los servicios cada 5 segundos sin desmontar las filas.
Clientes actualiza su directorio cada 10 segundos.

Clientes combina perfiles de ms-cliente y cuentas Identity con rol CLIENTE,
unidos por correo normalizado antes de filtrar y paginar. Una cuenta nueva sin
compras se muestra como cliente web con documento pendiente; no se crea un perfil
ficticio ni se inventa una fecha de registro. Historial conserva las reservas Booking
y consulta las compras web por el identificador de usuario cuando existe.

En Administracion > Reservas > Reservas de clientes del sitio, Ver saga muestra
el estado actual confirmado de pago, inventario y, si corresponde, reembolso y
restitucion de cupos. No es una cronologia de eventos ni la telemetria de
Observabilidad. El mismo listado permite check-in para reservas confirmadas,
pagadas y sin cancelacion en curso, verificando documento del titular y guia.

Para publicar estas mejoras se requieren el frontend y ms-cart actualizados.
ms-cart debe recibir CLIENT_SERVICE_URL con la URL interna de ms-cliente.

## Publicacion compatible con pestanas abiertas

Despues del build de produccion, publicar con
`infrastructure/deployment/azure/deploy-frontend.ps1 -Version <version-unica>`.
Este script conserva archivos JS/CSS inmutables anteriores para que una pestana
abierta pueda seguir cargando la pantalla de pago despues de un despliegue.
Ver `docs/operations/FIX-RESERVAR-ASSETS-2026-11-13.md` desde la raiz del repositorio.
