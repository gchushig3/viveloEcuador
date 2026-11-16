# Correccion de Reservar tras despliegues - 2026-11-13

Causa confirmada: los despliegues ZIP anteriores retiraron archivos JavaScript
inmutables utilizados por pestanas que seguian abiertas. Al abrir la ruta de
pago, Angular intentaba importar un chunk anterior ausente. El hosting devolvia
index.html con HTTP 200 y Content-Type text/html para ese archivo .js, y la
navegacion fallaba. Los contadores agregados de telemetria confirmaron errores
de carga de modulos JavaScript; no se exportaron mensajes, rutas ni identidades.

Correccion publicada: assets-compat-web-20261113, main-TEPDIXK6.js.
Se restauraron 80 archivos JS/CSS con nombres hash de las copias anteriores.
La version actual de index.html y web.config se conserva.

El procedimiento permanente de publicacion ahora es:

1. Compilar apps/booking-web con npm.cmd run build.
2. Ejecutar infrastructure/deployment/azure/deploy-frontend.ps1 -Version <version-unica>.
3. Verificar release.json, hashes y flujo de reserva.

El script crea una copia del hosting antes de publicar y mezcla solamente
archivos JS/CSS inmutables anteriores con el build nuevo. Esto conserva la
compatibilidad de las pestanas abiertas. Usar este script en publicaciones
futuras, en lugar de los scripts puntuales antiguos que empaquetaban solo el
ultimo build.

Validacion publica:

- main-NHLXWRZW.js y chunk-BiySCwRZ.js vuelven a responder como JavaScript y sus SHA-256 coinciden con el respaldo.
- Version y bundle actuales correctos; catalogo y CORS HTTP 200.
- Chrome cargo el index anterior main-NHLXWRZW.js contra los archivos reales del hosting, con contexto de cliente de prueba, en escritorio 1280px y movil 390px.
- En dos atracciones, Reservar abrio Confirmar y pagar y el formulario Revisar reserva sin errores de ejecucion.
- Cero solicitudes de compra: no se crearon reservas, cuentas ni pagos reales en estas pruebas.

Si una pestana ya habia memorizado la importacion fallida, recargar con Ctrl+F5.

Artefactos: .tmp/azure-frontend-assets-compat-web-20261113/.
Respaldo previo: previous-wwwroot.zip dentro de ese directorio.
