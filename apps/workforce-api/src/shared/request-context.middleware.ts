import { Injectable, type NestMiddleware } from '@nestjs/common';
import { uuidv4 } from '@workforce/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequestContextService } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: FastifyRequest['raw'], response: FastifyReply['raw'], next: () => void): void {
    const headerValue = request.headers[REQUEST_ID_HEADER];
    const incoming = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    // request id จาก client ถูกส่งต่อไปที่ log และ response — ต้อง sanitize
    // ไม่งั้นกลายเป็นช่องทาง log injection / header splitting
    const requestId =
      typeof incoming === 'string' &&
      incoming.length > 0 &&
      incoming.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : uuidv4();

    response.setHeader(REQUEST_ID_HEADER, requestId);

    const forwardedFor = request.headers['x-forwarded-for'];
    const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ip = forwarded?.split(',')[0]?.trim() ?? request.socket.remoteAddress ?? null;
    const userAgentHeader = request.headers['user-agent'];

    this.requestContext.run(
      {
        requestId,
        ip: ip === '' ? null : ip,
        userAgent: typeof userAgentHeader === 'string' ? userAgentHeader.slice(0, 512) : null,
        principal: null,
        startedAt: new Date(),
      },
      next,
    );
  }
}
