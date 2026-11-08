import type { OpenAPIObject, OperationObject, PathItemObject } from '@nestjs/swagger';

const services = [
  ['auth', 'Autenticación'],
  ['cart', 'Carrito'],
  ['booking', 'Reservas'],
  ['catalog', 'Catálogo'],
  ['inventory', 'Inventario'],
  ['payment', 'Pagos'],
  ['audit', 'Auditoría'],
] as const;

const methods = ['get', 'post', 'put', 'patch', 'delete', 'options'] as const;

export function addGatewayPaths(document: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};
  for (const version of ['v1', 'v2', 'v3']) {
    for (const [service, tag] of services) {
      const operation: OperationObject = {
        tags: [tag],
        summary: `Reenviar solicitud al servicio ${tag} (${version})`,
        description:
          'El gateway valida la autenticación, los roles y el límite de solicitudes; el servicio conserva la lógica de negocio.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'path',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Ruta del endpoint expuesto por el microservicio.',
          },
        ],
        responses: {
          '200': { description: 'Respuesta del servicio destino.' },
          '400': { description: 'Solicitud inválida.' },
          '401': {
            description: 'JWT ausente o inválido.',
            content: {
              'application/json': {
                example: {
                  success: false,
                  statusCode: 401,
                  message: 'Invalid or expired credentials',
                  correlationId: '8f5a1a1f-0454-4a2d-beb0-d9be73532e2b',
                },
              },
            },
          },
          '403': {
            description: 'Rol insuficiente.',
            content: {
              'application/json': {
                example: {
                  success: false,
                  statusCode: 403,
                  message: 'Insufficient role',
                  correlationId: '8f5a1a1f-0454-4a2d-beb0-d9be73532e2b',
                },
              },
            },
          },
          '429': { description: 'Límite de solicitudes excedido.' },
          '502': { description: 'Servicio destino no disponible.' },
          '504': { description: 'Tiempo de espera agotado.' },
        },
      };
      const item: PathItemObject = Object.fromEntries(
        methods.map((method) => [method, operation]),
      ) as PathItemObject;
      const rootOperation: OperationObject = {
        ...operation,
        parameters: [],
        summary: `Reenviar solicitud al servicio ${tag} (${version})`,
      };
      const rootItem: PathItemObject = Object.fromEntries(
        methods.map((method) => [method, rootOperation]),
      ) as PathItemObject;
      paths[`/api/${version}/${service}/{path}`] = item;
      paths[`/api/${version}/${service}`] = rootItem;
    }
    for (const endpoint of [
      'register',
      'login',
      'refresh',
      'verify-email',
      'resend-verification',
      'forgot-password',
      'reset-password',
    ]) {
      paths[`/api/${version}/auth/${endpoint}`] = {
        post: {
          tags: ['Autenticación'],
          summary: `Identity: ${endpoint}`,
          security: [],
          responses: {
            '200': { description: 'Respuesta del servicio Identity.' },
            '400': { description: 'Solicitud inválida.' },
            '429': { description: 'Límite de solicitudes excedido.' },
          },
        },
      };
    }
  }
  paths['/health'] = {
    get: {
      tags: ['Salud'],
      summary: 'Estado de Gateway y servicios dependientes',
      security: [],
      responses: {
        '200': {
          description: 'Todos los servicios están disponibles.',
          content: {
            'application/json': { example: { status: 'UP' } },
          },
        },
        '503': {
          description: 'Uno o más servicios no están disponibles.',
          content: {
            'application/json': {
              example: { status: 'DOWN' },
            },
          },
        },
      },
    },
  };
  paths['/health/live'] = {
    get: {
      tags: ['Salud'],
      summary: 'Estado del proceso Gateway',
      security: [],
      responses: {
        '200': {
          description: 'El proceso está activo.',
          content: {
            'application/json': { example: { status: 'UP' } },
          },
        },
      },
    },
  };
  paths['/health/ready'] = paths['/health'];
  document.paths = paths;
  document.tags = [
    ...services.map(([name, description]) => ({
      name: description,
      description: `Endpoints enrutados mediante /api/{version}/${name}/...`,
    })),
    { name: 'Salud', description: 'Disponibilidad de Gateway y dependencias.' },
  ];
  return document;
}
