import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, isUuid } from '@workforce/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { firstValueFrom, from, type Observable } from 'rxjs';
import { IDEMPOTENT_KEY } from '../shared/decorators';
import { RequestContextService } from '../shared/request-context';
import { IdempotencyService } from './idempotency.service';

const HEADER = 'idempotency-key';

/**
 * บังคับ idempotency ให้ mutation ที่ประกาศ @Idempotent() (ADR-0008)
 *
 * ทำงานหลัง guard เสมอ (Nest เรียก guard ก่อน interceptor) จึงมี tenant/principal
 * ให้ผูกกับคีย์ได้แล้ว
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isIdempotent !== true) return next.handle();

    return from(this.handle(context, next));
  }

  private async handle(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const headerValue = request.headers[HEADER];
    const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (key === undefined || !isUuid(key)) {
      throw AppError.validation('Idempotency-Key header is required and must be a UUID');
    }

    const principal = this.requestContext.requirePrincipal();
    const fingerprint = this.idempotency.fingerprint({
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      method: request.method,
      path: request.url.split('?')[0] ?? request.url,
      body: request.body,
    });

    const decision = await this.idempotency.begin({
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      key,
      fingerprint,
    });

    if (decision.kind === 'REPLAY') {
      // ตอบผลลัพธ์เดิม ไม่ใช่ error — client ที่ timeout แล้ว retry ต้องได้ผลเหมือนเดิม
      void reply.status(decision.status).header('idempotency-replayed', 'true');
      return decision.body;
    }

    try {
      const body = await firstValueFrom(next.handle() as Observable<unknown>);
      await this.idempotency.complete({
        tenantId: principal.tenantId,
        key,
        status: reply.statusCode,
        body,
      });
      return body;
    } catch (error) {
      await this.idempotency.release({ tenantId: principal.tenantId, key });
      throw error;
    }
  }
}
