# Corrección de errores de consola — 2026-11-13

Publicado en Azure: ms-inventory, ms-catalog y api-gateway con revisión
`console-fix-20261113-175322`. Frontend `console-fix-web-20261113-175322`,
bundle `main-D4VNT5TL.js`; las tres revisiones backend quedaron listas.

Cambios:

- El editor usa GET protegido `/atracciones/admin/detalle/:id`, capaz de leer
  borradores e inactivas. Antes usaba el detalle público limitado a publicadas.
  El endpoint público mantiene su restricción de publicación.
- El gateway permite credenciales CORS únicamente para su lista configurada de
  orígenes. Esto permite los preflights de sendBeacon de observabilidad.
- RegisterSlots inserta todas las fechas de cada horario en una consulta SQL
  con CTE. Conserva bloqueos transaccionales, capacidad explícita e idempotencia.
  El cliente Catalog permite 25 segundos para registrar lotes; las otras
  operaciones conservan sus 8 segundos. El gateway permite 30 segundos.

Diagnóstico de producción: ListSlots respondía correctamente, mientras
RegisterSlots agotaba sus 8 segundos. Después aparecían eventos de stock
sincronizados: la transacción podía completarse después del error al cliente.

Validación:

- Frontend: 170 pruebas aprobadas y build de producción correcto.
- Catalog: 125 pruebas completas y una nueva de detalle administrativo aprobadas;
  typecheck correcto.
- Gateway: 9 pruebas aprobadas, incluyendo CORS permitido y origen rechazado.
- Inventory: 12 pruebas aprobadas, una de outbox omitida por requerir otra base.
  PostgreSQL local dedicado verificó 360 turnos de capacidad 7, repetición con
  capacidad 20 sin sobrescribir los existentes y reintentos concurrentes sin
  duplicados. El contenedor temporal se detuvo al terminar.
- Azure: lote existente de 30 turnos de la atracción 21 se repitió en 650 ms,
  created=0, skipped=30. El turno consultado tenía total=5, available=5.
  No se crearon turnos reales durante esta comprobación.
- Readiness gateway y salud Catalog: HTTP 200. Creación de clientes y detalle
  administrativo sin sesión: HTTP 401. Preflight de observabilidad: HTTP 204,
  origen permitido correcto y Access-Control-Allow-Credentials=true.
- El chunk anterior chunk-UMnmEgrb.js responde HTTP 200. Se conservaron 132
  archivos inmutables anteriores. ERR_NAME_NOT_RESOLVED no se reprodujo.
- La atracción 21 también respondió HTTP 200 en su detalle público al verificar;
  el 404 anterior no persiste. El editor ya no depende de su publicación.

Los avisos Tracking Prevention pertenecen al dominio externo i0.wp.com; no se
modificaron preferencias del navegador ni URLs de fotografías.

Respaldo y evidencias:

- `.tmp/azure-release-console-fix/manifest.json`: imágenes/revisiones anteriores.
- `.tmp/azure-release-console-fix/deployed.json`: revisiones nuevas.
- `.tmp/azure-release-console-fix/public-verification.json`: pruebas públicas.
- `.tmp/azure-frontend-console-fix-web-20261113-175322/previous-wwwroot.zip`:
  respaldo del frontend anterior.

Para revertir, actualizar Container Apps a previous.image del manifiesto y
publicar el ZIP anterior en App Service mediante Entra.
