import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { AppError, isAppError } from '@workforce/domain';
import type { FastifyReply } from 'fastify';
import { RequestContextService } from './request-context';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  request_id: string;
  errors?: { path: string; message: string }[];
  meta?: Record<string, unknown>;
}

/**
 * แปลง error ทุกชนิดเป็น RFC 9457 problem+json (spec §13)
 *
 * error ที่ไม่รู้จักตอบ 500 พร้อมข้อความกลาง ๆ — รายละเอียดอยู่ใน log ฝั่ง server เท่านั้น
 * เพื่อไม่ให้ stack trace หรือข้อความจาก driver หลุดออกไปหา client
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = this.requestContext.requestId;
    const problem = this.toProblem(exception, requestId);

    if (problem.status >= 500) {
      this.logger.error(
        { requestId, err: exception instanceof Error ? exception.message : String(exception) },
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (problem.status === 401 || problem.status === 403) {
      // การถูกปฏิเสธสิทธิ์เป็นสัญญาณความปลอดภัย ต้องเห็นใน log เสมอ
      this.logger.warn({ requestId, code: problem.code, title: problem.title });
    }

    void reply.status(problem.status).header('content-type', 'application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, requestId: string): ProblemBody {
    if (isAppError(exception)) return this.fromAppError(exception, requestId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: unknown }).message as string | undefined);

      return {
        type: `urn:workforce:error:http-${status}`,
        title: exception.name,
        status,
        ...(detail === undefined ? {} : { detail: String(detail) }),
        code: `HTTP_${status}`,
        request_id: requestId,
      };
    }

    return {
      type: 'urn:workforce:error:internal',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL',
      request_id: requestId,
    };
  }

  private fromAppError(error: AppError, requestId: string): ProblemBody {
    const meta = error.meta;
    const errors = meta?.['errors'] as { path: string; message: string }[] | undefined;
    const remainingMeta =
      meta === undefined ? undefined : Object.fromEntries(Object.entries(meta).filter(([key]) => key !== 'errors'));

    return {
      type: error.problemType,
      title: error.message,
      status: error.status,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      code: error.code,
      request_id: requestId,
      ...(errors === undefined ? {} : { errors }),
      ...(remainingMeta === undefined || Object.keys(remainingMeta).length === 0
        ? {}
        : { meta: remainingMeta }),
    };
  }
}
