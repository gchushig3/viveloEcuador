# Enterprise Service Bus

Servicio REST independiente de integración con proveedores. Implementa el despacho
REST outbound definido en `contracts/openapi/atracciones-openapi-v3.yaml`.
Requiere Node 24 y no tiene dependencias externas.

## Ejecución

Desde `apps/esb`, copia `.env.example` a `.env`, configura los secretos y la URL
real de Catalog, y ejecuta `npm start`. Ejecuta `npm test` para verificarlo con
servidores HTTP locales reales. Para Docker: `docker build -t booking-esb .` y
`docker run --env-file .env -p 3010:3010 booking-esb`. En Docker, sustituye
`localhost` del proveedor por su nombre DNS o `host.docker.internal`.

## Contrato de entrada

Todas las operaciones requieren `X-Api-Key` con `ESB_API_KEY`,
`Content-Type: application/json` e `Idempotency-Key` de 8 a 128 caracteres
alfanuméricos, guiones o guiones bajos. `X-Correlation-Id` es opcional; si falta
se genera un UUID. Usa la misma clave de idempotencia para reintentar la misma
operación y claves distintas para creación, cancelación y check-in.

| Entrada ESB (POST) | Destino del proveedor (POST) |
| --- | --- |
| `/api/v1/providers/:serviceId/reservations` | `baseUrlRest/reservas` |
| `/api/v1/providers/:serviceId/reservations/:id/cancel` | `baseUrlRest/reservas/:id/cancel` |
| `/api/v1/providers/:serviceId/reservations/:id/checkin` | `baseUrlRest/reservas/:id/checkin` |

El cuerpo es el JSON del contrato v3 del proveedor, sin traducciones de campos.
El ESB conserva cuerpo, estado y tipo de contenido de la respuesta, incluidos
`400`, `422` y `409 OUT_OF_STOCK`. Cada proveedor valida su propio contrato.
`GET /health/live` verifica únicamente el proceso y no requiere autenticación.

Ejemplo desde PowerShell:

```powershell
$headers = @{
  'X-Api-Key' = $env:ESB_API_KEY
  'Idempotency-Key' = 'booking-order-0001'
  'X-Correlation-Id' = 'booking-order-0001'
}
Invoke-RestMethod -Method Post `
  -Uri http://localhost:3010/api/v1/providers/atracciones-dilan/reservations `
  -Headers $headers -ContentType application/json `
  -Body (Get-Content ./reservation.json -Raw)
```

## Registro y garantías

`ESB_PROVIDERS` es un array JSON con `serviceId`, `baseUrlRest` y `apiKeyEnv`.
La base debe incluir el prefijo contractual, por ejemplo `/api/v3/atracciones`.
`apiKeyEnv` referencia una variable con la credencial del proveedor; el ESB
sustituye la clave entrante por esa credencial. Solo acepta proveedores del
registro y rutas explícitas; no sigue redirecciones ni reenvía JWT del cliente.
En producción exige HTTPS para los proveedores; publica el ESB en red privada
o detrás de terminación TLS. El timeout predeterminado es 10 segundos y el
límite por cuerpo de solicitud/respuesta es 1 MiB.

No reintenta escrituras: un timeout puede ocurrir después de confirmar una
reserva. El cliente debe reintentar con la misma clave y el proveedor debe
garantizar idempotencia. La creación de reservas de Catalog ya la implementa;
verifica esa garantía para cada operación de otros proveedores.

Los logs JSON contienen correlación, proveedor, estado y duración, sin cuerpos
ni secretos. El Event Bus RabbitMQ existente continúa atendiendo las sagas
internas. Este servicio no cobra ni ejecuta compensaciones LIFO: devuelve el
conflicto al orquestador que conoce las operaciones previas del checkout.

El registro inicial se carga del entorno, no de la base externa
`schema_proveedores.config_proveedor`, que no existe en este repositorio.
El gateway existente no se modifica: los consumidores autorizados invocan
este servicio explícitamente. No se ha desplegado ni conectado al Booking remoto.
