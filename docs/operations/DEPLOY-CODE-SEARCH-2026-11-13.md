# Despliegue de busqueda por codigo - 2026-11-13

Alcance: frontend. Sin cambios de backend ni esquema.

- Version: code-search-web-20261113.
- Bundle: main-TEPDIXK6.js.
- Reservas de clientes del sitio incluye busqueda inmediata por codigo completo o parcial, sin distinguir mayusculas, boton para limpiar y contador de coincidencias.
- El filtro aplica sobre las ultimas 100 reservas del listado y se conserva durante la actualizacion automatica.
- Build de produccion correcto. Chrome local con respuestas API controladas: busqueda parcial en mayusculas, resultado vacio, limpieza, saga y check-in; escritorio 1440px y movil 390px, sin errores de ejecucion.
- Respaldo anterior: .tmp/azure-frontend-code-search/previous-wwwroot.zip.
- Paquete y manifiesto: .tmp/azure-frontend-code-search/.

URL: https://viveloecuador-hufhcvg6eah6e2fm.brazilsouth-01.azurewebsites.net/admin/reservas

Verificacion publica completada: version y SHA-256 correctos, rutas del panel y catalogo/CORS correctos. Chrome sobre la web publicada verifico la busqueda en escritorio y movil con respuestas API controladas; sin errores de ejecucion ni operaciones reales de compra o check-in.
