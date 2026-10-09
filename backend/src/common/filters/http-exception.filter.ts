import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

/**
 * One consistent error shape for the whole API. The mobile client only ever has
 * to look at `statusCode` + `message`.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Unexpected error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const obj = payload as { message?: string | string[]; error?: string };
        message = obj.message ?? exception.message;
        error = obj.error ?? exception.name;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      error = exception.name || 'InternalServerError';
    }

    const body: ApiErrorBody = {
      statusCode: status,
      error,
      message,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}
