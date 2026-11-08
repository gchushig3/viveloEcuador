# Validación de administración y reservas

Actualización del 4 de noviembre de 2026: las correcciones B2B ya fueron desplegadas y verificadas en Azure. Véase [el reporte de resolución de certificación](REPORTE-RESOLUCION-BOOKING.md). El contenido siguiente corresponde a la validación local del 3 de noviembre y sus límites en esa fecha.

Fecha: 3 de noviembre de 2026, America/Guayaquil.

## Cambios realizados

- Panel con navegación accesible, accesos rápidos y diseño adaptable.
- Alta de administradores desde Usuarios, conectada a Identity: cuenta y rol atómicos, contraseña cifrada, asignador registrado y validación de sesión y permisos.
- Reservas del carrito visibles para ADMIN mediante una ruta protegida. El panel distingue este origen de las reservas del socio Booking; el resumen numérico identifica su alcance.
- Disponibilidad administrativa con totales del rango y validación que impide reducir la capacidad por debajo de las personas reservadas.
- Booking deja de confirmar reservas sin consumir aforo. Usa Inventory por gRPC y compite por los mismos cupos que el carrito.
- Reservas y cancelaciones de Booking toleran respuestas perdidas. La cancelación registra su intención antes de liberar cupos, para impedir que un reintento tardío reactive una reserva.
- Checkout conserva su clave de idempotencia al reintentar en la pantalla y evita borrar la línea del carrito de un intento en curso.
- Cliente: entrada con QR local, confirmación de cancelación, actualización manual y seguimiento del reembolso que se detiene al salir de la pantalla.
- Infraestructura compartida versionada como 0.3.2 y lockfiles actualizados. Se corrigieron las copias instaladas obsoletas que impedían entregar `pago.reembolsado` a Inventory. La suite integrada comprueba que las copias instaladas coincidan con el contrato compilado.
- Cart de desarrollo apunta al puerto local 3000, coherente con el arranque predeterminado del servicio, en lugar de mezclar backend local y remoto.

## Resultados

| Verificación | Resultado |
| --- | --- |
| Catalog | Build y 91 pruebas correctos |
| Identity | Build y 51 pruebas correctos |
| Inventory | Build y 2 pruebas correctos |
| Cart | Build y 1 prueba correctos |
| Payment | Build y 197 pruebas correctos |
| Refund | Build y 3 pruebas correctos |
| Audit | Build y 2 pruebas correctos |
| Billing Profile | Build y 6 pruebas correctos |
| Coupon | Build y 11 pruebas correctos |
| Location | Build y 21 pruebas correctos |
| Review | Build y 6 pruebas correctos |
| Support | Build y 2 pruebas correctos |
| Infraestructura compartida | Build y 6 pruebas correctos |
| Angular | Build de producción y 124 pruebas correctos |
| Integración PostgreSQL / HTTP / gRPC | 15 escenarios correctos |
| RabbitMQ AMQPS real | 1 escenario correcto |
| Chrome, 1440 y 390 px | Alta ADMIN, navegación, reservas, QR y confirmación de cancelación correctos; sin errores de JavaScript ni desbordamiento horizontal |

Total: 539 pruebas automatizadas correctas, además de las verificaciones de navegador en dos anchos. El build inicial Angular queda en aproximadamente 464 kB, dentro del presupuesto de 500 kB.

### Escenario de dos cupos para mañana

La fecha se calcula en America/Guayaquil; en esta ejecución corresponde al 4 de noviembre de 2026.

1. La prueba prepara una atracción de prueba en el PostgreSQL aislado de Catalog y crea un horario de dos cupos mediante la administración real de Inventory por gRPC.
2. `POST /api/v3/atracciones/reservas`, servido por HTTP real, reserva dos personas: respuesta 201 y disponibilidad cero.
3. Repetir con la misma clave devuelve la misma reserva, sin otro descuento.
4. Una compra adicional de Booking y una compra del carrito se rechazan por agotamiento.
5. Cancelar dos veces libera exactamente dos cupos.
6. El carrito compra esos dos cupos, la saga confirma pago e inventario y una nueva compra de Booking vuelve a rechazarse.

También se probaron compras concurrentes, cambio de datos con la misma clave, respuestas perdidas, cancelación adelantada, pago fallido, expiración, reembolso duplicado, atomicidad de reservas con varios ítems, recuperación del outbox y permisos de las rutas.

## Repetir las pruebas

Después de instalar las dependencias y compilar los servicios según este repositorio:

```powershell
# Desde la raíz del monorepo
node --test tests/integration/saga/integration.mjs
node --test tests/integration/saga/broker.integration.mjs

# Desde apps/booking-web
npm.cmd test -- --watch=false
npm.cmd run build
npm.cmd run test:admin-v2
```

Las suites de cada microservicio se ejecutan con `npm.cmd test` en su carpeta. La integración requiere Docker y PostgreSQL 16; el ensayo AMQPS requiere RabbitMQ y OpenSSL. Cada ensayo usa sus propios contenedores y los retira al finalizar.

## Alcance y límites

- Las reglas de dominio se verificaron con PostgreSQL, HTTP y gRPC reales. Las consultas auxiliares Identity/Catalog del carrito usan respuestas controladas y su saga se entrega con una bomba de pruebas que incluye duplicados. La entrega del broker se comprobó por separado con RabbitMQ real sobre TLS.
- La prueba visual usa el build de producción y respuestas HTTP controladas; no equivale a una sesión de navegador contra todos los servicios remotos desplegados.
- El ESB externo de Booking no está incluido en este repositorio. Se verificó su contrato de entrada HTTP v3, sin comprobar un recorrido por su infraestructura remota.
- El servicio de pagos sigue siendo una simulación; no se hicieron cobros bancarios reales.
- No se desplegaron cambios ni se modificaron cuentas o reservas de producción.
- Para desplegar, actualizar primero Inventory con el proto nuevo y después Catalog e Identity. Inventory prepara la tabla aditiva de asignaciones y Catalog las columnas de idempotencia al iniciar; se requieren permisos DDL. No se reconcilian automáticamente las reservas históricas que se crearon antes sin asignación de cupos.
- Booking debe conservar `Idempotency-Key` al reintentar. Las operaciones interrumpidas se ven como PENDIENTE o CANCELANDO y pueden reintentarse; no se añadió un reconciliador automático.
- El listado administrativo del carrito muestra las últimas 100 reservas. El listado de Booking mantiene sus filtros y paginación.
