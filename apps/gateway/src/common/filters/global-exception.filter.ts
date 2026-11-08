import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { attachStructuredAccessLog } from '../../infrastructure/logging/structured-access-log.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    attachStructuredAccessLog(request, response);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof responseBody === 'string'
        ? responseBody
        : responseBody &&
            typeof responseBody === 'object' &&
            'message' in responseBody &&
            typeof responseBody.message === 'string'
          ? responseBody.message
          : statusCode >= 500
            ? 'Internal server error'
            : 'Request failed';
    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      correlationId: request.correlationId ?? null,
    });
  }
}
