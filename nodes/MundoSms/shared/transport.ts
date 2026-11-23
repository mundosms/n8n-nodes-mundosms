/**
 * Las peticiones a la API REST v3 de MundoSMS: firmadas por la credencial (su `authenticate`), con los reintentos del SDK
 * y los listados por cursor.
 *
 * Cada POST lleva su Idempotency-Key (shared/idempotency.ts), la misma en todos sus intentos. Reintenta, como el SDK: un
 * 429, en cualquier método (no se hizo nada); un fallo de red o un 409 «Duplicated request» (la misma petición firmada llegó
 * dos veces), en cualquier método, y un POST con su clave también ante un 409 «Request in progress» (la primera con esa
 * clave aún no ha terminado); un 5xx, solo en GET (la API no guarda los 5xx: repetir un POST lo haría otra vez). Espera lo
 * que diga Retry-After (como mucho 60 s) o, si no lo trae, 1, 2, 4 s.
 *
 * Una respuesta 2xx se devuelve siempre, también con "status": "error". El 202 de un WhatsApp sin confirmar (WhatsApp no
 * contestó y el mensaje PUEDE haber salido) llega con "status": "success" y data.state "unknown": si fuera un error,
 * «Retry On Fail» de n8n lo repetiría y el cliente lo recibiría dos veces.
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'mundoSmsApi';
const PACKAGE_VERSION = '1.0.1';
const REPEATABLE_METHODS = ['GET', 'PATCH', 'DELETE'];
const RETRIES = 3;
const MAX_WAIT_SECONDS = 60;
const TIMEOUT_MS = 60000;

/** Segundos antes del siguiente intento: lo que pida Retry-After (segundos o fecha HTTP), o 1, 2, 4… Como mucho 60. */
function retryWait(retryAfter: unknown, attempt: number): number {
	let seconds: number | null = null;
	if (typeof retryAfter === 'string' && retryAfter) {
		const n = Number(retryAfter);
		seconds = Number.isFinite(n) ? n : (Date.parse(retryAfter) - Date.now()) / 1000;
		if (!Number.isFinite(seconds)) seconds = null;
	}
	if (seconds === null) seconds = 2 ** (attempt - 1);
	return Math.max(0, Math.min(MAX_WAIT_SECONDS, seconds));
}

function getHeader(headers: unknown, name: string): string | undefined {
	if (!headers || typeof headers !== 'object') return undefined;
	for (const [k, v] of Object.entries(headers as IDataObject)) {
		if (k.toLowerCase() === name) return Array.isArray(v) ? String(v[0]) : String(v);
	}
	return undefined;
}

function decodeBody(body: unknown): IDataObject | null {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	if (typeof body === 'string' && body.trim().startsWith('{')) {
		try {
			return JSON.parse(body) as IDataObject;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Una petición a la API. `path`: "/calls", "/sms/sends/71234567"… (sin /v3). Devuelve la respuesta entera, decodificada.
 * `idempotencyKey`: la Idempotency-Key de un POST (la de `idempotencyKey()` de shared/idempotency.ts), la misma en todos sus
 * intentos.
 */
export async function mundoSmsRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	qs: IDataObject = {},
	body: IDataObject | undefined = undefined,
	itemIndex = 0,
	idempotencyKey: string | undefined = undefined,
): Promise<IDataObject> {
	const headers: IDataObject = { 'User-Agent': 'n8n-nodes-mundosms/' + PACKAGE_VERSION };
	if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
	const repeatableWithoutResponse = REPEATABLE_METHODS.includes(method) || (method === 'POST' && !!idempotencyKey);
	for (let attempt = 1; ; attempt++) {
		let response: { statusCode: number; headers: IDataObject; body: unknown };
		try {
			response = await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, {
				method,
				url: path,
				qs,
				body,
				headers,
				ignoreHttpStatusErrors: true,
				returnFullResponse: true,
				timeout: TIMEOUT_MS,
			});
		} catch (error) {
			// sin respuesta (la red, el plazo agotado): GET, PATCH y DELETE se pueden repetir, y un POST con su Idempotency-Key
			if (repeatableWithoutResponse && attempt <= RETRIES) {
				await sleep(retryWait(undefined, attempt) * 1000);
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
		}
		const statusCode = response.statusCode;
		const json = decodeBody(response.body);
		if (statusCode >= 200 && statusCode < 300) {
			return json ?? { status: 'success', status_code: '0', message: 'OK' };
		}
		const message = json && typeof json.message === 'string' ? json.message : '';
		const retryable =
			statusCode === 429 ||
			(method === 'GET' && statusCode >= 500) ||
			(statusCode === 409 && message.startsWith('Duplicated request') && repeatableWithoutResponse) ||
			(statusCode === 409 && message === 'Request in progress' && method === 'POST' && !!idempotencyKey);
		if (retryable && attempt <= RETRIES) {
			await sleep(retryWait(getHeader(response.headers, 'retry-after'), attempt) * 1000);
			continue;
		}
		const requestId = getHeader(response.headers, 'x-request-id');
		const detail = [
			json && typeof json.detail === 'string' ? json.detail : '',
			requestId ? 'X-Request-Id: ' + requestId : '',
		]
			.filter(Boolean)
			.join(' · ');
		throw new NodeApiError(this.getNode(), (json ?? { message: 'HTTP ' + statusCode }) as JsonObject, {
			httpCode: String(statusCode),
			message: json && typeof json.message === 'string' ? json.message : 'HTTP ' + statusCode,
			description: detail || undefined,
			itemIndex,
		});
	}
}

/**
 * Un listado por cursor: cada página con los mismos filtros más el `cursor` (el `next_cursor` de la anterior), hasta que
 * `has_more` sea false. La lista es el primer campo de `data` que sea una lista. Con `returnAll` a false, hasta `limit`.
 */
export async function mundoSmsList(
	this: IExecuteFunctions,
	path: string,
	filters: IDataObject,
	returnAll: boolean,
	limit: number,
	maxPageSize: number,
	itemIndex: number,
): Promise<IDataObject[]> {
	const qs: IDataObject = { ...filters };
	const items: IDataObject[] = [];
	const seenCursors = new Set<string>();
	let listField: string | null = null;
	for (;;) {
		qs.limit = returnAll ? maxPageSize : Math.min(maxPageSize, limit - items.length);
		const response = await mundoSmsRequest.call(this, 'GET', path, qs, undefined, itemIndex);
		const data = (response.data ?? {}) as IDataObject;
		if (listField === null) listField = Object.keys(data).find((k) => Array.isArray(data[k])) ?? null;
		if (listField) items.push(...(data[listField] as IDataObject[]));
		if (!returnAll && items.length >= limit) return items.slice(0, limit);
		if (!data.has_more || !data.results || !data.next_cursor) return items;
		// un cursor que ya salió daría vueltas para siempre: mejor parar con un error que dejar el workflow colgado
		const cursor = String(data.next_cursor);
		if (seenCursors.has(cursor)) {
			throw new NodeOperationError(this.getNode(), `The API returned the cursor "${cursor}" twice for ${path}`, {
				itemIndex,
				description: 'Stopped to avoid an endless loop. Check the filters, or try again later.',
			});
		}
		seenCursors.add(cursor);
		qs.cursor = cursor;
	}
}
