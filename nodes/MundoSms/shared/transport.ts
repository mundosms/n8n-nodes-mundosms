/**
 * Las peticiones a la API REST v3 de MundoSMS: firmadas por la credencial (su `authenticate`), con los reintentos del SDK
 * y los listados por cursor.
 *
 * Cada POST lleva su Idempotency-Key (shared/idempotency.ts), la misma en todos sus intentos. Reintenta, como el SDK: un
 * 429, en cualquier método (no se hizo nada); un fallo de red o un 409 con code duplicated_request (la misma petición firmada
 * llegó dos veces), en cualquier método, y un POST con su clave también ante un 409 con code request_in_progress (la primera
 * con esa clave aún no ha terminado); un 5xx, solo en GET. Un POST con 5xx no se repite: un 500 puede llegar con la operación
 * hecha y la API lo guarda con la clave (repetirlo con ella devuelve ese mismo 500, sin hacerlo otra vez), y un 503 no hizo
 * nada (se puede repetir con la misma clave: «Retry On Fail» lo hace, porque la clave es la misma en la misma ejecución).
 * Espera lo que diga Retry-After (como mucho 60 s) o, si no lo trae, 1, 2, 4 s. Un 409 se decide por su code, nunca por el
 * texto del message.
 *
 * Una respuesta 2xx con JSON se devuelve siempre, también con "status": "error"; una vacía es {"status": "success", "message":
 * "OK"}, y una que no es JSON (el HTML de un proxy o de un portal cautivo), un error, como en los SDK (1.0.4). El 202 de un
 * WhatsApp sin confirmar (WhatsApp no contestó y el mensaje PUEDE haber salido) llega con "status": "success" y data.state
 * "unknown": si fuera un error, «Retry On Fail» de n8n lo repetiría y el cliente lo recibiría dos veces.
 *
 * Los errores llevan en `context.mundoSms` lo que sale con «Continue On Fail» y por la salida de error (1.0.4): code, http,
 * message, detail, data y request_id (MundoSms.node.ts).
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'mundoSmsApi';
const PACKAGE_VERSION = '1.0.5';
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

/** Un cuerpo vacío (un 204, o un 2xx sin nada): no es un error. */
function isEmptyBody(body: unknown): boolean {
	if (body === undefined || body === null) return true;
	if (typeof body === 'string') return body.trim() === '';
	if (typeof body === 'object' && 'length' in body) return (body as { length: unknown }).length === 0;
	return false;
}

/**
 * Lo que sale de un error con «Continue On Fail» o por la salida de error (MundoSms.node.ts lo lee de `context.mundoSms`):
 * los campos de la respuesta de la API, como en los SDK. Sin respuesta, `http` 0 y el resto a null.
 */
function withApiFields(
	error: NodeApiError,
	fields: { code: string | null; http: number; message: string; detail: string | null; data: unknown; requestId: string | null },
): NodeApiError {
	error.context.mundoSms = {
		code: fields.code,
		http: fields.http,
		message: fields.message,
		detail: fields.detail,
		data: (fields.data ?? null) as IDataObject | null,
		request_id: fields.requestId,
	};
	return error;
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
			throw withApiFields(new NodeApiError(this.getNode(), error as JsonObject, { itemIndex }), {
				code: null,
				http: 0,
				message: 'No response from the API: ' + String((error as Error).message ?? error),
				detail: null,
				data: null,
				requestId: null,
			});
		}
		const statusCode = response.statusCode;
		const json = decodeBody(response.body);
		const requestId = getHeader(response.headers, 'x-request-id') ?? null;
		if (statusCode >= 200 && statusCode < 300) {
			if (json) return json;
			if (isEmptyBody(response.body)) return { status: 'success', message: 'OK' };
			// 1.0.4: un 2xx que no es JSON (el HTML de un proxy o de un portal cautivo) no es una respuesta de la API: es un error,
			// como en los SDK. Hasta la 1.0.3 salía como un éxito vacío
			const contentType = (getHeader(response.headers, 'content-type') ?? '').split(';')[0].trim();
			const notJson = `HTTP ${statusCode}: the response is not JSON (${contentType || 'no Content-Type'})`;
			throw withApiFields(
				new NodeApiError(this.getNode(), { message: notJson } as JsonObject, {
					httpCode: String(statusCode),
					message: notJson,
					description: requestId ? 'X-Request-Id: ' + requestId : undefined,
					itemIndex,
				}),
				{ code: null, http: statusCode, message: notJson, detail: null, data: null, requestId },
			);
		}
		const code = json && typeof json.code === 'string' ? json.code : '';
		const retryable =
			statusCode === 429 ||
			(method === 'GET' && statusCode >= 500) ||
			(statusCode === 409 && code === 'duplicated_request' && repeatableWithoutResponse) ||
			(statusCode === 409 && code === 'request_in_progress' && method === 'POST' && !!idempotencyKey);
		if (retryable && attempt <= RETRIES) {
			await sleep(retryWait(getHeader(response.headers, 'retry-after'), attempt) * 1000);
			continue;
		}
		const apiDetail = json && typeof json.detail === 'string' ? json.detail : null;
		const message = json && typeof json.message === 'string' ? json.message : 'HTTP ' + statusCode;
		const detail = [apiDetail ?? '', requestId ? 'X-Request-Id: ' + requestId : ''].filter(Boolean).join(' · ');
		throw withApiFields(
			new NodeApiError(this.getNode(), (json ?? { message: 'HTTP ' + statusCode }) as JsonObject, {
				httpCode: String(statusCode),
				message,
				description: detail || undefined,
				itemIndex,
			}),
			{
				code: json && json.code !== undefined && json.code !== null ? (typeof json.code === 'string' ? json.code : JSON.stringify(json.code)) : null,
				http: statusCode,
				message,
				detail: apiDetail,
				data: json ? json.data : null,
				requestId,
			},
		);
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
		// El final, como en los SDK (1.0.3): has_more false (con stop_at_ongoing, también la página que se para en una llamada
		// en curso), sin next_cursor, con ongoing_call o con el cursor quieto. Una página VACÍA con has_more true no es el
		// final: es la de una lista con un filtro que ha mirado muchas filas sin coincidencias (el tope de 5.000 de
		// GET /v3/calls), y su next_cursor avanza. Hasta la 1.0.2 se paraba ahí y devolvía la lista cortada sin avisar
		if (!data.has_more || !data.next_cursor || data.ongoing_call) return items;
		const cursor = String(data.next_cursor);
		if (cursor === qs.cursor) return items;
		// un cursor que ya salió antes daría vueltas para siempre: mejor parar con un error que dejar el workflow colgado
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
