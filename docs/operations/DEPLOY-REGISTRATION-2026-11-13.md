# Despliegue de mejoras de registro y checkout - 2026-11-13

Frontend publicado en Azure App Service: viveloecuador (grupo viveloecuador_group).

- Version: registration-web-20261113.
- Bundle: main-YQCGXVXN.js.
- Validacion previa: 156 pruebas aprobadas y build de produccion correcto.
- Verificacion publica: release.json, index, ruta /reservas y SHA-256 del bundle coinciden con el build local.
- Catalogo y CORS: HTTP 200.
- Chrome: numero de tarjeta de ejemplo aceptado para revisar el pago simulado; correccion conserva datos; cero solicitudes de compra y cero errores de ejecucion.
- Respaldo previo: .tmp/azure-frontend-registration/previous-wwwroot.zip.
- Paquete y manifiesto: .tmp/azure-frontend-registration/.
- Reversion: publicar previous-wwwroot.zip en el mismo App Service mediante Microsoft Entra.

No se modificaron servicios backend ni se realizaron compras en produccion.

URL: https://viveloecuador-hufhcvg6eah6e2fm.brazilsouth-01.azurewebsites.net
