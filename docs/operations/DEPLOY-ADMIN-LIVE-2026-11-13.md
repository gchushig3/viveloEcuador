# Despliegue del panel de administracion - 2026-11-13

Completado: frontend y ms-cart. Sin migraciones adicionales de esquema.

- ms-cart: ms-cart--admin-live-20261113-125820, Healthy / Provisioned.
- Imagen: acrbookingbackend.azurecr.io/ms-cart:admin-live-20261113-125820.
- CLIENT_SERVICE_URL configurada hacia la direccion interna de ms-cliente.
- Frontend: admin-live-web-20261113, main-NHLXWRZW.js.
- SHA-256 del bundle publico coincide con el build local.
- Rutas /admin, /admin/clientes y /admin/reservas responden correctamente.
- Catalogo y CORS: HTTP 200. Endpoints administrativos sin sesion: HTTP 401.
- Dentro del contenedor desplegado se ejecutaron adminSummary y adminReservations contra la base real en una transaccion READ ONLY: ADMIN_QUERIES_OK.
- La consulta interna de clientes desde ms-cart respondio correctamente: CLIENT_SERVICE_OK.
- Chrome sobre la web publicada: escritorio 1440px y movil 390px; directorio combinado, busqueda, paginacion, historial, check-in y Ver saga correctos. Estas pruebas de interfaz usaron respuestas API controladas; no crearon cuentas, compras ni asistencias reales.
- Validacion local: 162 pruebas de frontend y 24 de ms-cart aprobadas; builds correctos.

Recuperacion:

- .tmp/azure-release-admin-live/manifest.json contiene imagen y revision previas de ms-cart.
- .tmp/azure-release-admin-live/deployed.json contiene la revision publicada.
- .tmp/azure-frontend-admin-live/previous-wwwroot.zip contiene el frontend anterior.
- Para revertir, actualizar ms-cart a previous.image y publicar el ZIP anterior en el mismo App Service mediante Entra.

Ubicacion de la saga: Administracion > Reservas > Reservas de clientes del sitio > Ver saga. Muestra el estado de pago, inventario y compensaciones; no una cronologia de eventos.

URL: https://viveloecuador-hufhcvg6eah6e2fm.brazilsouth-01.azurewebsites.net/admin

Comprobacion adicional del gateway:

La verificacion final detecto que Booking y Catalog comprobaban simultaneamente
la misma URL de salud. Cada llamada a esa URL abre una conexion RabbitMQ nueva;
el diagnostico paralelo mostro una respuesta 503 de Booking (RabbitMQ no conectado)
y 200 de Catalog, mientras los chequeos individuales respondian correctamente.
El gateway ahora comparte una unica promesa por URL dentro de cada comprobacion;
una falla real sigue devolviendo DOWN y la proxima comprobacion vuelve a consultar.
Se agregaron pruebas de deduplicacion y propagacion de fallas: 8 pruebas del gateway
aprobadas. Imagen de correccion: api-gateway:admin-health-20261113-130542.
Respaldo y revision: .tmp/azure-release-admin-health/.

Verificacion final completada:

- Gateway: api-gateway--admin-health-20261113-130542, revision lista.
- /health/ready devolvio HTTP 200 en tres consultas consecutivas tras la correccion.
- Frontend, ms-cart y gateway publicados; no quedan componentes del cambio por desplegar.
- Total de pruebas locales aprobadas: 194 (162 frontend, 24 carrito, 8 gateway).
