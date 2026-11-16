# Despliegue de clientes y capacidad — 2026-11-13

Completado en Azure. Servicios publicados, en orden: ms-cliente, ms-catalog y
ms-cart. Los tres tienen la revisión `clients-capacity-20261113-172735`, con
aprovisionamiento Succeeded y latestReadyRevisionName igual a la nueva revisión.
Se conservaron las variables y secretos existentes; en Carrito se configuró
CLIENT_SERVICE_URL hacia la dirección interna de ms-cliente.

Frontend: `clients-capacity-web-20261113-172735`, bundle `main-OBAPST5S.js`.
Incluye Crear cliente sin cuenta y capacidad explícita al crear turnos.
Se conservaron 119 archivos inmutables anteriores para pestañas abiertas.

Validación:

- 169 pruebas frontend, 125 Catalog, 26 Carrito y 14 Clientes aprobadas.
- Compilaciones Docker correctas y typecheck de Catalog aprobado.
- Se corrigió una prueba frontend dependiente de la hora para usar fecha futura,
  las expectativas antiguas de check-in de Carrito para reflejar su regla actual
  de reservas pagadas, y tipos de fixtures de pruebas de Catalog.
- SHA-256 del bundle público igual al local:
  `9c5c47c81f1798e40289d2e223db81a6b4d7ed59ee7060c14d1c8b1eaa5a10d2`.
- /admin/clientes, /admin/atracciones, catálogo público, salud Catalog y readiness
  del gateway: HTTP 200. POST administrativo sin sesión: HTTP 401.
- Desde Catalog: listado de Clientes correcto, POST vacío al nuevo endpoint
  interno devuelve 400 y la nueva ruta está en el código desplegado.
- Desde Carrito: consultas administrativas reales en transacción READ ONLY y
  conexión con Clientes correctas.
- Chrome sobre la web publicada, 1440 y 390 px: formulario, validación,
  confirmación y visualización del cliente sin cuenta correctos; cero errores
  de ejecución. APIs controladas en esta prueba visual, sin registros reales.

Durante la actualización el gateway respondió temporalmente 503; tras completar
Carrito, readiness volvió a HTTP 200. No se modificaron cupos existentes ni se
crearon clientes, cuentas, compras o asistencias reales durante la verificación.
Los turnos existentes con capacidad incorrecta aún requieren actualización de
datos: eliminar el valor predeterminado del formulario no los modifica.

Recuperación y evidencias locales:

- `.tmp/azure-release-clients-capacity/manifest.json`: imágenes y revisiones previas.
- `.tmp/azure-release-clients-capacity/deployed.json`: revisiones publicadas.
- `.tmp/azure-release-clients-capacity/public-verification.json`: comprobaciones HTTP.
- `.tmp/azure-release-clients-capacity/ui-verification.json`: prueba visual.
- `.tmp/azure-frontend-clients-capacity-web-20261113-172735/previous-wwwroot.zip`:
  respaldo del frontend previo.

Para revertir, actualizar cada Container App a su imagen previous.image del
manifiesto y publicar el ZIP anterior en App Service mediante Entra.

Panel: https://viveloecuador-hufhcvg6eah6e2fm.brazilsouth-01.azurewebsites.net/admin/clientes
