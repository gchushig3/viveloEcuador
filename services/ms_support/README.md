# MS Support Service

Microservicio de soporte del Sistema de Atracciones (Descubre EC).

- **Responsabilidad:** Gestionar los mensajes de contacto / soporte: tabla `mensaje_contacto`.
- **Contrato:** REST con prefijo global `/api/v2`; especificacion OpenAPI en [`contract/ms_support-openapi-v1.yaml`](./contract/ms_support-openapi-v1.yaml).
- **Base de datos:** `ms_support` (database-per-service).
- **Dependencias externas:** MS Identity para autenticar y autorizar las rutas privadas.

## Endpoints

Crear mensajes requiere autenticacion. Listarlos, consultarlos, marcarlos como
leidos o eliminarlos requiere el rol `ADMIN`. `GET /api/v2/health` es publico.

| Metodo | Ruta | Descripcion | Respuesta |
|---|---|---|---|
| POST | `/api/v2/support/messages` | Crear un mensaje de contacto | 201 + `Location` |
| GET | `/api/v2/support/messages` | Listar mensajes; filtro opcional `leido=true\|false` (ADMIN) | 200 |
| GET | `/api/v2/support/messages/:id` | Obtener un mensaje (ADMIN) | 200 / 404 |
| PATCH | `/api/v2/support/messages/:id` | Cambiar `men_leido` (ADMIN) | 200 / 404 |
| DELETE | `/api/v2/support/messages/:id` | Eliminar un mensaje (ADMIN) | 204 / 404 |
| GET | `/api/v2/health` | Consultar la salud del servicio | 200 |

## Base de datos

El esquema y los datos iniciales se encuentran en `init-support.sql`
(tables: `mensaje_contacto` y domain `dom_correo`).

## Ejecucion local

```bash
# 1. Levantar PostgreSQL (Docker)
docker compose up -d

# 2. Aplicar esquema y datos iniciales
psql -U postgres -d ms_support -f init-support.sql

# 3. Levantar el microservicio
npm run start:dev
```

El puerto local por defecto es `3000`.

## Tests

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e
```

## Despliegue

Fuera de alcance en esta fase (solo se requiere el microservicio listo y funcional).
