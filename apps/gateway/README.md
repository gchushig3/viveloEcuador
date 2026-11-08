# API Gateway

Gateway NestJS 12 para clientes Web, Mobile y consumidores externos. No incluye
reglas de negocio ni acceso a bases de datos; valida la identidad y enruta
solicitudes HTTP a los servicios configurados.

En despliegue, publica únicamente este gateway en el ingress externo y limita
los puertos de los microservicios a la red privada de servicios.

## Desarrollo local

Requiere Node.js 24.9+ y npm 11+. Copia `.env.example` a `.env`, ajusta las URL
y prefijos a los servicios que tienes en ejecución, y después:

```powershell
npm ci
npm run start:dev
```

La aplicación escucha en `http://localhost:3000`. Swagger está en `/docs`;
`/health/live` verifica el proceso y `/health` y `/health/ready` consultan la
disponibilidad de los servicios configurados. La readiness devuelve HTTP 503
si uno de los seis servicios comprobados (Identity, Cart, Booking, Catalog,
Inventory o Payment) no responde con un estado exitoso. Audit se enruta, pero no
bloquea la readiness.

Para desarrollo en contenedor, desde este directorio ejecuta
`docker compose up --build`; monta `src` y observa cambios. Crea antes el
archivo `.env` y configura todas las URL de destino. Desde otros contenedores
usa nombres DNS de Compose en lugar de `host.docker.internal`.

## Rutas y versionado

`/api/v1`, `/api/v2` y `/api/v3` se aceptan como versiones de entrada. El gateway
conserva el servicio y el sufijo de ruta y los combina con el prefijo interno
configurado. Las versiones públicas son alias de enrutamiento: no convierten
contratos ni alteran cuerpos, códigos o respuestas.

| Ruta pública | Destino predeterminado |
| --- | --- |
| `/api/v{1,2,3}/auth/*` | `IDENTITY_URL` + `/api/v2/auth/*` |
| `/api/v{1,2,3}/cart/*` | `CART_URL` + `/api/v2/cart/*` |
| `/api/v{1,2,3}/booking/*` | `BOOKING_URL` + `/api/v3/atracciones/reservas/*` |
| `/api/v{1,2,3}/catalog/*` | `CATALOG_URL` + `/api/v2/*` |
| `/api/v{1,2,3}/inventory/*` | `INVENTORY_URL` + `/api/v2/inventory/*` |
| `/api/v{1,2,3}/payment/*` | `PAYMENT_URL` + `/api/v2/*` |
| `/api/v{1,2,3}/audit/*` | `AUDIT_URL` + `/api/v2/audit/*` |

Modifica `*_API_PREFIX` si el contrato interno del servicio cambia. El servicio
de reservas puede desplegarse junto con Catalog; `BOOKING_URL` y su prefijo
permiten mantenerlo separado o adaptar el enrutamiento sin cambiar código.

## Seguridad y operación

- Los JWT se verifican localmente con RS256, tipo `identity-access+jwt`,
  audiencia y emisor de Identity. Por defecto, el conjunto JWKS se obtiene de
  Identity; `JWT_PUBLIC_KEY` permite suministrar una clave pública PEM montada
  por el entorno. Nunca se acepta un secreto HMAC.
- Los endpoints de autenticación pública de Identity (registro, inicio,
  renovación y recuperación) y los endpoints de salud no requieren JWT. Las
  demás rutas requieren un access token.
- Los roles de Identity `CLIENTE` y `OPERADOR` se mapean respectivamente a
  `CUSTOMER` y `PARTNER`; `ADMIN` se conserva. El gateway restringe auditoría y
  administración de Identity a ADMIN, carrito/pagos a CUSTOMER o ADMIN, y
  mutaciones de catálogo/inventario a PARTNER o ADMIN. Los microservicios deben
  seguir verificando sus propios permisos.
- El gateway elimina los headers `X-User-*` recibidos del cliente y establece
  `X-User-Id` y `X-User-Role` desde el JWT verificado. Emite `X-User-Email`
  únicamente cuando el token incluye un claim `email` firmado; los access
  tokens actuales de Identity no lo incluyen. Los roles múltiples se separan
  por comas.
- `X-Correlation-Id` se reutiliza si contiene de 1 a 128 caracteres seguros;
  de otro modo se responde 400. Si no se envía, se genera un UUID v4. Se
  propaga al upstream y se registra en logs JSON junto al método, ruta, usuario,
  estado y duración.
- El rate limit predeterminado es 100/500/1000 solicitudes por minuto para
  CUSTOMER/PARTNER/ADMIN. Se aplica una ventana fija en memoria por usuario
  (o 100 solicitudes por minuto y por IP para rutas públicas), por lo que cada réplica tiene su propio
  contador. Para despliegues con varias réplicas, sustituye el almacenamiento
  local por un backend compartido antes de depender de límites globales.
- Se reenvían `traceparent` y `tracestate` recibidos para facilitar la futura
  instrumentación OpenTelemetry. No se exportan spans ni métricas todavía.
- La readiness consulta `/api/v2/health/ready` en cada servicio y tiene timeout
  limitado. Ajusta la URL o el path de readiness mediante la configuración del
  despliegue si un servicio usa otro endpoint.

## Variables de entorno

| Variable | Requerida | Predeterminado / uso |
| --- | --- | --- |
| `PORT`, `NODE_ENV` | No | `3000`, `development` |
| `IDENTITY_URL`, `CART_URL`, `BOOKING_URL`, `CATALOG_URL`, `INVENTORY_URL`, `PAYMENT_URL`, `AUDIT_URL` | Sí | Origen HTTP(S) de cada servicio, sin path |
| `*_API_PREFIX` | No | Prefijo upstream de la tabla anterior |
| `JWT_JWKS_URL` | No | `${IDENTITY_URL}/api/v2/.well-known/jwks.json` |
| `JWT_PUBLIC_KEY` | No | PEM público RS256 alternativo a JWKS |
| `JWT_ISSUER`, `JWT_AUDIENCE` | No | `urn:descubreec:identity`, `urn:descubreec:internal-api` |
| `CORS_ORIGINS` | No | Lista separada por comas; vacío deshabilita CORS |
| `RATE_LIMIT_CUSTOMER`, `RATE_LIMIT_PARTNER`, `RATE_LIMIT_ADMIN` | No | `100`, `500`, `1000` por minuto |
| `PROXY_TIMEOUT_MS`, `HEALTH_TIMEOUT_MS` | No | `30000`, `2500` ms |
| `HEALTH_IDENTITY_PATH`, `HEALTH_CART_PATH`, `HEALTH_BOOKING_PATH`, `HEALTH_CATALOG_PATH`, `HEALTH_INVENTORY_PATH`, `HEALTH_PAYMENT_PATH` | No | `/api/v2/health/ready` por servicio |

La validación de configuración se realiza al arrancar. Las URL de servicios son
orígenes HTTP(S) sin credenciales, paths, query ni fragmento. No configures
secretos JWT privados en el Gateway.
