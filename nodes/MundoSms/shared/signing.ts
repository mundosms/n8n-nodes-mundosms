/**
 * La firma de la API REST v3 de MundoSMS, con la misma codificación que el SDK de Node.js (mundosms.js):
 *
 *   X-Signature = base64url( HMAC-SHA256( clave_privada, token + "." + X-Timestamp + "." + MÉTODO + " " + ruta_con_query + "." + cuerpo ) )
 *
 * Lo firmado es justo lo que se manda: la ruta se codifica trozo a trozo (un %XX ya escrito se respeta), la query en RFC 3986
 * y el cuerpo es el texto JSON exacto. La usa la credencial (su `authenticate`, con `signRequest`), así que firma tanto las
 * peticiones del nodo como la prueba de la credencial y el nodo HTTP Request con esta credencial.
 */
import { createHmac } from 'crypto';
import type { ICredentialDataDecryptedObject, IDataObject, IHttpRequestOptions } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.mundosms.es/v3';

/** RFC 3986: todo codificado menos A-Z a-z 0-9 - . _ ~ (encodeURIComponent deja sin codificar ! ' ( ) *). */
export function rfc3986(s: string): string {
	return encodeURIComponent(s).replace(
		/[!'()*]/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
	);
}

/** Un valor de la query: true/false, una lista separada por comas; null, undefined o una lista vacía, nada. */
export function queryValue(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (Array.isArray(v)) {
		const values = v.map(queryValue).filter((x): x is string => x !== null);
		return values.length ? values.join(',') : null;
	}
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

/** Cada trozo de la ruta codificado (un %XX ya escrito se respeta). */
export function encodePath(path: string): string {
	return path
		.split('/')
		.map((segment) =>
			segment
				.split(/(%[0-9A-Fa-f]{2})/)
				.map((x, i) => (i % 2 ? x : rfc3986(x)))
				.join(''),
		)
		.join('/');
}

/** La query de unos parámetros, en RFC 3986 y en su orden. */
export function encodeQuery(pairs: Array<[string, unknown]>): string {
	return pairs
		.map(([k, v]) => [k, queryValue(v)] as [string, string | null])
		.filter((p): p is [string, string] => p[1] !== null)
		.map(([k, text]) => rfc3986(k) + '=' + rfc3986(text))
		.join('&');
}

export function computeSignature(
	privateKey: string,
	token: string,
	timestamp: string,
	method: string,
	pathWithQuery: string,
	body: string,
): string {
	return createHmac('sha256', privateKey)
		.update(token + '.' + timestamp + '.' + method + ' ' + pathWithQuery + '.' + body)
		.digest('base64url');
}

function isPlainObject(v: unknown): v is IDataObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

/**
 * Prepara y firma una petición. La ruta puede ser relativa a la base de la credencial («/calls», «/v3/calls»: el /v3 se quita
 * si la base ya lo lleva) o una URL entera. Los parámetros de `qs` se pasan a la query (en una ruta relativa, ganan a los que
 * traiga tras «?»); en POST y PATCH un cuerpo objeto se manda como JSON; en GET y DELETE no hay cuerpo.
 */
export async function signRequest(
	credentials: ICredentialDataDecryptedObject,
	request: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const o: IHttpRequestOptions & { uri?: string } = { ...request, headers: { ...(request.headers ?? {}) } };
	const method = String(o.method ?? 'GET').toUpperCase();
	const token = String(credentials.token ?? '').trim();
	const privateKey = String(credentials.privateKey ?? '').trim();
	const base = String(o.baseURL || credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const urlField = o.url === undefined && typeof o.uri === 'string' ? 'uri' : 'url';
	const target = String((urlField === 'uri' ? o.uri : o.url) ?? '');
	const qs: Array<[string, unknown]> = isPlainObject(o.qs) ? Object.entries(o.qs) : [];

	let origin: string;
	let path: string;
	let query: string;
	if (/^https?:\/\//i.test(target)) {
		// una URL entera (el nodo HTTP Request): su query tal cual (ya escapada) y, detrás, la de qs
		const full = new URL(target);
		origin = full.origin;
		path = full.pathname;
		query = [full.search.replace(/^\?/, ''), encodeQuery(qs)].filter(Boolean).join('&');
	} else {
		const baseParsed = new URL(base);
		origin = baseParsed.origin;
		const queryStart = target.indexOf('?');
		let relative = '/' + (queryStart >= 0 ? target.slice(0, queryStart) : target).replace(/^\/+/, '');
		if (baseParsed.pathname.endsWith('/v3') && (relative === '/v3' || relative.startsWith('/v3/'))) {
			relative = '/' + relative.slice(3).replace(/^\/+/, '');
		}
		path = new URL(baseParsed.href.replace(/\/+$/, '') + encodePath(relative)).pathname;
		const fromTarget = new Map<string, unknown>(
			queryStart >= 0 ? new URLSearchParams(target.slice(queryStart + 1)) : [],
		);
		for (const [k, v] of qs) fromTarget.set(k, v);
		query = encodeQuery([...fromTarget]);
	}
	const signedPath = path + (query ? '?' + query : '');
	if (urlField === 'uri') o.uri = origin + signedPath;
	else o.url = origin + signedPath;
	delete o.baseURL;
	delete o.qs;

	let body = '';
	if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
		delete o.body;
	} else if (typeof o.body === 'string') {
		body = o.body;
	} else if (isPlainObject(o.body) && Object.keys(o.body).length) {
		body = JSON.stringify(o.body);
		o.body = body;
	} else {
		delete o.body;
	}

	const timestamp = String(Date.now()); // milisegundos: dos peticiones iguales seguidas no firman igual
	const headers = o.headers as IDataObject;
	for (const k of Object.keys(headers)) {
		if (['authorization', 'x-timestamp', 'x-signature', 'content-type'].includes(k.toLowerCase())) delete headers[k];
	}
	headers.Authorization = 'Bearer ' + token;
	headers['X-Timestamp'] = timestamp;
	headers.Accept = 'application/json';
	if (body) headers['Content-Type'] = 'application/json';
	if (privateKey) headers['X-Signature'] = computeSignature(privateKey, token, timestamp, method, signedPath, body);
	return o;
}
