# Registro de clientes desde administración

En Administración > Clientes, `Crear cliente` permite guardar nombre y correo
obligatorios, con identificación y teléfono opcionales. No crea una cuenta de
Identity, no solicita contraseña y no envía invitaciones.

El navegador llama a `POST /api/v2/atracciones/admin/clientes`, protegido por el
guard administrativo existente (JWT vigente y rol ADMIN). Catalog valida y
normaliza los datos y llama al endpoint privado de ms-cliente,
`POST /api/v2/clientes/admin`. Este último registra el origen TIENDA y omite
cualquier usuario_id enviado en el cuerpo. Responde `{ cliente, reused }`;
reused indica que se utilizó un perfil existente según las reglas de identidad
de ms-cliente. El listado incluye perfiles sin cuenta aunque no tengan compras.

Para publicar esta funcionalidad se requieren ms-cliente, ms-catalog y el
frontend actualizados, en ese orden. ms-cliente debe permanecer en la red
privada como exige su contrato actual.

Validación local: 21 pruebas del frontend (clientes, directorio y cupos),
14 pruebas de ms-cliente y 2 pruebas nuevas de Catalog aprobadas. La compilación
de producción de Catalog también pasa. El typecheck general detecta dos errores
en test/unit/booking-contract.spec.ts (líneas 130 y 134: string | undefined);
ese archivo ya tenía modificaciones y no fue cambiado en esta tarea.
