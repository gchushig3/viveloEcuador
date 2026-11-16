# MS Billing Profile Service

Microservicio de facturacion del Sistema de Atracciones (Descubre EC).

- **Responsabilidad:** Gestionar los datos de facturacion: tabla `dato_facturacion`.
- **Contrato:** [OpenAPI 3.0](contract/ms_billing_profile-openapi-v1.yaml); prefijo global `/api/v2`.
- **Base de datos:** `ms_billing_profile` (database-per-service).
- **Autenticación:** access JWT validado por Identity; cada operación queda limitada al usuario del token.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v2/billing-profiles` | Lista los datos activos del usuario autenticado. |
| GET | `/api/v2/billing-profiles/:id` | Obtiene un dato activo propio. |
| POST | `/api/v2/billing-profiles` | Crea un dato y devuelve `201` con `Location`. |
| PATCH | `/api/v2/billing-profiles/:id` | Actualiza razón social, correo, teléfono o estado principal. |
| DELETE | `/api/v2/billing-profiles/:id` | Desactiva el dato (baja lógica) y devuelve `204`. |
| GET | `/api/v2/health` | Health check público. |

El contrato OpenAPI detalla esquemas, validaciones y respuestas de error.
El servicio no expone Swagger UI.

## Base de datos

El esquema y los datos iniciales se encuentran en `init-billing_profile.sql`
(tables: `dato_facturacion` y domains `dom_correo` / `dom_telefono`).

## Ejecucion local

```bash
# 1. Levantar PostgreSQL (Docker)
docker compose up -d

# 2. Aplicar esquema y datos iniciales
psql -U postgres -d ms_billing_profile -f init-billing_profile.sql

# 3. Levantar el microservicio
npm run start:dev
```

API local: <http://localhost:3000/api/v2>

## Tests

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e
```

## Despliegue

Fuera de alcance en esta fase (solo se requiere el microservicio listo y funcional).
