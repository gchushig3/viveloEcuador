import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service.js';

@Controller()
export class ProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @All('api/:version/:service/{*path}')
  async forward(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.proxy.forward(request, response);
  }

  @All('api/:version/:service')
  async forwardRoot(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.proxy.forward(request, response);
  }
}
