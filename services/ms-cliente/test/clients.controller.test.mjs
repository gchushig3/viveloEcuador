import "reflect-metadata";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ClientsController } from "../dist/clients.controller.js";
import { ClientsService } from "../dist/clients.service.js";

describe("ClientsController (unitario)", () => {
  let module, controller, service;
  const client = {
    client_id: "72854a89-5f2b-4c42-8802-3a976cd2db6b",
    nombre: "Ana",
    email: "ana@example.com",
    identificacion: "0123456789",
  };
  beforeEach(async () => {
    service = {
      find: mock.fn(async () => client),
      byId: mock.fn(async () => client),
      register: mock.fn(async () => ({ client, created: true })),
      list: mock.fn(async () => ({ items: [client] })),
    };
    module = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [{ provide: ClientsService, useValue: service }],
    }).compile();
    controller = module.get(ClientsController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it("consulta un cliente sin exponer campos adicionales del almacenamiento", async () => {
    assert.deepEqual(
      await controller.find(client.email, client.identificacion),
      client,
    );
    assert.deepEqual(service.find.mock.calls[0].arguments, [
      client.email,
      client.identificacion,
    ]);
  });
  it("devuelve NotFound si no existe el cliente", async () => {
    service.find.mock.mockImplementation(async () => null);
    await assert.rejects(controller.find(client.email), NotFoundException);
  });

  it("crea desde admin sin asociar una cuenta enviada por el navegador", async () => {
    assert.deepEqual(await controller.createAdmin({ nombre: 'Ana', email: ' ANA@EXAMPLE.COM ', usuario_id: '42', origen: 'BOOKING' }), { cliente: client, reused: false });
    assert.deepEqual(service.register.mock.calls[0].arguments, [{ nombre: 'Ana', email: client.email, origen: 'TIENDA' }]);
  });

  it("informa cuando el cliente administrativo ya existe", async () => {
    service.register.mock.mockImplementation(async () => ({ client, created: false }));
    assert.deepEqual(await controller.createAdmin({ nombre: 'Ana', email: client.email }), { cliente: client, reused: true });
  });
  it("registra desde Booking y normaliza el email", async () => {
    const response = { status: mock.fn() };
    assert.deepEqual(
      await controller.create(
        { nombre: "Ana", email: " ANA@EXAMPLE.COM " },
        response,
      ),
      { client_id: client.client_id },
    );
    assert.deepEqual(service.register.mock.calls[0].arguments, [
      { nombre: "Ana", email: client.email, origen: "BOOKING" },
    ]);
    assert.equal(response.status.mock.callCount(), 0);
  });
  it("responde 200 al reutilizar un cliente en lugar de anunciar otra creacion", async () => {
    service.register.mock.mockImplementation(async () => ({
      client,
      created: false,
    }));
    const response = { status: mock.fn() };
    await controller.create({ nombre: "Ana", email: client.email }, response);
    assert.deepEqual(response.status.mock.calls[0].arguments, [200]);
  });
  it("registra la compra web con el usuario autenticado y origen TIENDA", async () => {
    await controller.registerWeb(
      {
        nombre: "Ana",
        email: client.email,
        identificacion: client.identificacion,
      },
      "7",
    );
    assert.deepEqual(service.register.mock.calls[0].arguments, [
      {
        nombre: "Ana",
        email: client.email,
        identificacion: client.identificacion,
        usuario_id: "7",
        origen: "TIENDA",
      },
    ]);
  });
  it("rechaza el registro web sin usuario y no llama al servicio", async () => {
    await assert.rejects(
      controller.registerWeb({ nombre: "Ana", email: client.email }),
      BadRequestException,
    );
    assert.equal(service.register.mock.callCount(), 0);
  });
  it("convierte paginacion y rechaza limites fuera de rango", async () => {
    await controller.list("2", "10", "Ana");
    assert.deepEqual(service.list.mock.calls[0].arguments, [2, 10, "Ana"]);
    await assert.rejects(controller.list("1", "101"), BadRequestException);
    assert.equal(service.list.mock.callCount(), 1);
  });
  it("rechaza un identificador invalido antes de consultar", async () => {
    await assert.rejects(controller.detail("invalid"), BadRequestException);
    assert.equal(service.byId.mock.callCount(), 0);
  });
});
