import 'reflect-metadata';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller.js';
import { AuthService } from '../../src/auth/auth.service.js';
import type { AuthRequest, Principal } from '../../src/auth/auth.decorators.js';

describe('AuthController (unitario)', () => {
  let module: TestingModule;
  let controller: AuthController;
  const service = {
    register: jest.fn<AuthService['register']>(),
    login: jest.fn<AuthService['login']>(),
    refresh: jest.fn<AuthService['refresh']>(),
    verifyEmail: jest.fn<AuthService['verifyEmail']>(),
    requestVerification: jest.fn<AuthService['requestVerification']>(),
    resetPassword: jest.fn<AuthService['resetPassword']>(),
    me: jest.fn<AuthService['me']>(),
    logout: jest.fn<AuthService['logout']>(),
    sessions: jest.fn<AuthService['sessions']>(),
    revokeSession: jest.fn<AuthService['revokeSession']>(),
    changePassword: jest.fn<AuthService['changePassword']>(),
  };
  const principal: Principal = {
    userId: '7',
    sessionId: 'session-1',
    roles: ['CLIENTE'],
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();
    controller = module.get(AuthController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('registra el DTO sin agregar privilegios', async () => {
    const body = {
      email: 'ana@example.com',
      password: 'Clave-local-segura-42!',
      first_name: 'Ana',
      last_name: 'Prueba',
    };
    await controller.register(body);
    expect(service.register).toHaveBeenCalledWith(body);
  });
  it('envia credenciales, IP y agente del navegador al iniciar sesion', async () => {
    const body = {
      email: 'ana@example.com',
      password: 'Clave-local-segura-42!',
    };
    const request = {
      ip: '127.0.0.1',
      get: () => 'test-browser',
    } as unknown as AuthRequest;
    await controller.login(body, request);
    expect(service.login).toHaveBeenCalledWith(body, {
      ip: '127.0.0.1',
      userAgent: 'test-browser',
    });
  });
  it('propaga credenciales rechazadas sin fabricar tokens', async () => {
    const error = new UnauthorizedException();
    service.login.mockRejectedValue(error);
    await expect(
      controller.login({ email: 'ana@example.com', password: 'wrong' }, {
        get: () => undefined,
      } as unknown as AuthRequest),
    ).rejects.toBe(error);
  });
  it('extrae los tokens y contrasenas de los DTO correctos', async () => {
    await controller.refresh({ refresh_token: 'refresh-1' });
    await controller.verifyEmail({ token: 'verify-1' });
    await controller.reset({
      token: 'reset-1',
      new_password: 'Clave-nueva-segura-42!',
    });
    expect(service.refresh).toHaveBeenCalledWith('refresh-1');
    expect(service.verifyEmail).toHaveBeenCalledWith('verify-1');
    expect(service.resetPassword).toHaveBeenCalledWith(
      'reset-1',
      'Clave-nueva-segura-42!',
    );
  });
  it('distingue verificacion de email y recuperacion de contrasena', async () => {
    await controller.resend({ email: 'ana@example.com' });
    await controller.forgot({ email: 'ana@example.com' });
    expect(service.requestVerification).toHaveBeenNthCalledWith(
      1,
      'ana@example.com',
      'EMAIL',
    );
    expect(service.requestVerification).toHaveBeenNthCalledWith(
      2,
      'ana@example.com',
      'RECUPERACION',
    );
  });
  it('conserva el principal al consultar perfil y sesiones', async () => {
    await controller.me(principal);
    await controller.sessions(principal);
    await controller.revoke(principal, 'session-2');
    expect(service.me).toHaveBeenCalledWith(principal);
    expect(service.sessions).toHaveBeenCalledWith(principal);
    expect(service.revokeSession).toHaveBeenCalledWith(principal, 'session-2');
  });
  it('distingue cerrar una sesion de cerrar todas', async () => {
    await controller.logout(principal);
    await controller.logoutAll(principal);
    expect(service.logout).toHaveBeenNthCalledWith(1, principal);
    expect(service.logout).toHaveBeenNthCalledWith(2, principal, true);
  });
  it('cambia la contrasena usando el principal autenticado', async () => {
    await controller.change(principal, {
      current_password: 'actual',
      new_password: 'Clave-nueva-segura-42!',
    });
    expect(service.changePassword).toHaveBeenCalledWith(
      principal,
      'actual',
      'Clave-nueva-segura-42!',
    );
  });
});
