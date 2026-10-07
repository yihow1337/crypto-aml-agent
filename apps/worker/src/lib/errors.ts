import type { ApiErrorBody, ApiErrorCode } from '@aml/engine';
import { ZodError } from 'zod';
import { ChainUnavailableError, UntrackableAddressError } from '../adapters/types';
import { BudgetExceededError, UpstreamError } from './http';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ChainUnavailableError) return new ApiError(503, 'CHAIN_UNAVAILABLE', err.message);
  if (err instanceof UntrackableAddressError) {
    return new ApiError(422, 'UPSTREAM_ERROR', `${err.message}，無法即時分析；可改查其他地址或參考內建情境。`);
  }
  if (err instanceof BudgetExceededError) return new ApiError(503, 'BUDGET_EXCEEDED', '本次請求的外部查詢次數已達上限，請稍後再試。');
  if (err instanceof UpstreamError) {
    if (err.status === 429) return new ApiError(503, 'UPSTREAM_ERROR', '鏈上資料來源暫時限流，請稍後再試。', 30);
    return new ApiError(502, 'UPSTREAM_ERROR', `鏈上資料來源錯誤：${err.message}`);
  }
  if (err instanceof ZodError) {
    return new ApiError(400, 'BAD_REQUEST', `請求格式錯誤：${err.issues.map((i) => i.message).join('; ')}`);
  }
  return new ApiError(500, 'INTERNAL', '系統內部錯誤');
}

export function errorBody(e: ApiError): ApiErrorBody {
  return { error: { code: e.code, message: e.message } };
}
