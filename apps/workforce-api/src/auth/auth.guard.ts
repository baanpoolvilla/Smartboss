import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@workforce/domain';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_ROUTE_KEY } from '../shared/decorators';
import { RequestContextService } from '../shared/request-context';
import { PrincipalLoader } from './principal-loader';
import { TokenVerifier } from './token-verifier';

/**
 * Guard ระดับ global — ทุก route ต้อง authenticate เว้นแต่ประกาศ @Public()
 *
 * เป็น default-deny: route ที่ลืมประกาศอะไรเลยจะต้อง authenticate
 * (แล้วไปตกที่ PermissionsGuard ซึ่งจะปฏิเสธเพราะไม่มี metadata สิทธิ์)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
    private readonly principalLoader: PrincipalLoader,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest & { principal?: unknown }>();
    const token = extractBearerToken(request.headers.authorization);
    if (token === null) throw AppError.unauthenticated('missing bearer token');

    const verified = await this.tokenVerifier.verify(token);
    const { principal, roles } = await this.principalLoader.load(verified);

    this.requestContext.setPrincipal(principal);
    request.principal = principal;
    (request as unknown as { principalRoles?: unknown }).principalRoles = roles;

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  return value !== undefined && value.length > 0 ? value : null;
}
