import { Injectable, type PipeTransform } from '@nestjs/common';
import { AppError } from '@workforce/domain';
import { ZodError, type ZodTypeAny } from 'zod';

/**
 * Validation ด้วย Zod — มาตรฐานเดียวทั้งระบบ (spec §15, ADR-0004)
 *
 * ผลลัพธ์คือค่าที่ผ่าน `parse` แล้ว ซึ่งรวม default และ coercion
 * handler จึงได้ค่าที่ผ่านการทำให้เป็นมาตรฐานแล้วเสมอ ไม่ใช่ค่าดิบจาก client
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        throw AppError.validation('request validation failed', {
          meta: {
            errors: error.issues.map((issue) => ({
              path: issue.path.join('.') || '(root)',
              message: issue.message,
            })),
          },
        });
      }
      throw error;
    }
  }
}

export function zodPipe(schema: ZodTypeAny): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
