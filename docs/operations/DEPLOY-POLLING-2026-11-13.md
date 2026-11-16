# Despliegue de polling silencioso — 2026-11-13

Alcance: `ms-catalog` y `apps/booking-web`. Sin migraciones de base de datos.

El catálogo conserva los campos de disponibilidad de Booking y añade
`available_spots` y `status` por horario, consultando los cupos de Inventory.
El frontend consulta reservas cada 4,5 segundos y disponibilidad cada 3,5
segundos sin reemplazar el formulario ni mostrar carga de pantalla completa.

Validación previa: 149 pruebas de frontend y 123 de catálogo; compilaciones correctas.

Artefactos y recuperación:

- `.tmp/azure-release-polling/manifest.json`: imagen y revisión anteriores del catálogo.
- `.tmp/azure-release-polling/deployed.json`: revisión desplegada, cuando finaliza.
- `.tmp/azure-frontend-polling/previous-wwwroot.zip`: respaldo del frontend anterior.
- `.tmp/azure-frontend-polling/manifest.json`: versión y bundle publicados.

La reversión del catálogo consiste en actualizar `ms-catalog` a la imagen
`previous.image` del manifiesto. El frontend puede revertirse publicando el ZIP
de respaldo en el mismo App Service mediante Microsoft Entra.

Verificación final completada en Azure:

- Catálogo: revisión `ms-catalog--polling-20261113-051232`, estado `Healthy`.
- Frontend: `polling-web-20261113`, bundle `main-KUFZUNXR.js`.
- Se verificó que el hash SHA-256 del JavaScript público coincide con el build local.
- Gateway readiness, catálogo y CORS correctos (HTTP 200).
- Chrome consultó la API real de disponibilidad en dos ciclos; la respuesta
  incluyó cupos numéricos para tres horarios y el formulario conservó sus valores.
- Con respuestas de reservas simuladas en el navegador, el JavaScript publicado
  realizó tres consultas, conservó la tarjeta y actualizó check-in/cancelación.
  El badge cancelado devolvió `rgb(185, 28, 28)` (`#b91c1c`).
- No se crearon, cancelaron ni modificaron reservas de producción en las pruebas.

Web: https://viveloecuador-hufhcvg6eah6e2fm.brazilsouth-01.azurewebsites.net
