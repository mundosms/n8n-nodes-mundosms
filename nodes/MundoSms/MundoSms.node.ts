import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { accountDescription } from './descriptions/account';
import { callDescription } from './descriptions/call';
import { campaignDescription } from './descriptions/campaign';
import { numcheckDescription } from './descriptions/numcheck';
import { queueDescription } from './descriptions/queue';
import { smsDescription } from './descriptions/sms';
import { whatsappDescription } from './descriptions/whatsapp';
import { rfc3986 } from './shared/signing';
import { idempotencyKey } from './shared/idempotency';
import { CREDENTIAL_NAME, mundoSmsList, mundoSmsRequest } from './shared/transport';

/** Lo más que da cada listado por página. */
const MAX_PAGE_SIZE: Record<string, number> = {
	'/calls': 100,
	'/queues': 500,
	'/sms': 500,
	'/whatsapp/messages': 500,
	'/whatsapp/opt-outs': 500,
};

/** Los campos opcionales que se mandan: sin los vacíos (texto vacío, 0 en un id). */
function nonEmptyFields(fields: IDataObject, idFields: string[] = []): IDataObject {
	const result: IDataObject = {};
	for (const [k, v] of Object.entries(fields)) {
		if (v === '' || v === null || v === undefined) continue;
		if (idFields.includes(k) && (v === 0 || v === '0')) continue;
		result[k] = v;
	}
	return result;
}

/** Una lista de números escrita separada por comas, punto y coma o saltos de línea. */
function parseNumberList(value: string): string[] {
	return value
		.split(/[,;\n]/)
		.map((x) => x.trim())
		.filter(Boolean);
}

/** Un texto de un campo, sin espacios alrededor: también un número que llega de una expresión. */
function text(value: unknown): string {
	return value === undefined || value === null ? '' : String(value).trim();
}

/** Un id que va en la ruta, codificado como lo firma la credencial. */
function pathId(value: unknown): string {
	return rfc3986(String(value).trim());
}

/**
 * Los agentes de una cola para `PATCH /queues/{id}`: la lista ENTERA (la API saca de la cola a los que no van), o `undefined`
 * si se dejan como están. Cada uno con sus cuatro campos: `ring_in_use` y `wrapup_time` a null son los de la cola.
 */
function queueAgents(this: IExecuteFunctions, i: number): IDataObject[] | undefined {
	const mode = this.getNodeParameter('agentsInput', i, 'keep') as string;
	if (mode === 'keep') return undefined;
	if (mode === 'json') {
		let value = this.getNodeParameter('agentsJson', i, '[]') as unknown;
		if (typeof value === 'string') {
			try {
				value = JSON.parse(value.trim() || '[]');
			} catch {
				throw new NodeOperationError(this.getNode(), 'Agents (JSON) is not valid JSON', { itemIndex: i });
			}
		}
		if (!Array.isArray(value)) {
			throw new NodeOperationError(this.getNode(), 'Agents (JSON) has to be a list', {
				itemIndex: i,
				description: 'For example: [{"agent": "reception"}, {"agent": "34600123456", "penalty": 1}]',
			});
		}
		return value as IDataObject[];
	}
	const rows = ((this.getNodeParameter('agents', i, {}) as IDataObject).agent ?? []) as IDataObject[];
	return rows.map((row, n) => {
		const penalty = typeof row.penalty === 'string' && /^\d+$/.test(row.penalty.trim()) ? Number(row.penalty) : row.penalty;
		const wrapup = text(row.wrapup_time);
		if (wrapup !== '' && !/^\d+$/.test(wrapup)) {
			throw new NodeOperationError(this.getNode(), `Agent ${n + 1}: the Wrap-Up Time has to be a whole number of seconds`, {
				itemIndex: i,
				description: 'Leave it empty to use the Wrap-Up Time of the queue.',
			});
		}
		return {
			agent: text(row.agent),
			penalty: penalty === undefined || penalty === null || penalty === '' ? 0 : penalty,
			ring_in_use: row.ring_in_use === 'yes' ? true : row.ring_in_use === 'no' ? false : null,
			wrapup_time: wrapup === '' ? null : Number(wrapup),
		};
	});
}

/** Lo que sale del nodo: `data` si la respuesta lo trae como objeto (y fue bien); si no, la respuesta entera. */
function toOutput(response: IDataObject): IDataObject {
	const data = response.data;
	if (response.status !== 'error' && data && typeof data === 'object' && !Array.isArray(data)) return data as IDataObject;
	return response;
}

export class MundoSms implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MundoSMS',
		name: 'mundoSms',
		icon: { light: 'file:../../icons/mundosms.svg', dark: 'file:../../icons/mundosms.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Send SMS and WhatsApp messages, check calls, manage call queues, launch VozPush campaigns and check numbers with MundoSMS',
		defaults: { name: 'MundoSMS' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_NAME, required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Call', value: 'call' },
					{ name: 'NumCheck', value: 'numcheck' },
					{ name: 'Queue', value: 'queue' },
					{ name: 'SMS', value: 'sms' },
					{ name: 'VozPush Campaign', value: 'campaign' },
					{ name: 'WhatsApp', value: 'whatsapp' },
				],
				default: 'sms',
			},
			...accountDescription,
			...smsDescription,
			...whatsappDescription,
			...callDescription,
			...campaignDescription,
			...numcheckDescription,
			...queueDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = await executeOperation.call(this, resource, operation, i);
				for (const json of results) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					// «Continue On Fail» y la salida de error (1.0.4): lo que trajo la API (code, http, message, detail, data y
					// request_id, de context.mundoSms: shared/transport.ts). Hasta la 1.0.3 solo salían error y description, y se
					// perdían el code y el código HTTP.
					// n8n solo manda un elemento por la SALIDA DE ERROR si su json no tiene más que error, message y details
					// (handleNodeErrorOutput de n8n-core; un `error` en el elemento tampoco vale: normalizeNodeErrors deja el json
					// en {error}). Con la salida de error, lo de la API va en `details`; con «Continue» (la salida normal), arriba.
					// Hasta la 1.0.3, por su `description`, un error con la salida de error salía por la BUENA
					const e = error as Error & { description?: string | null; context?: IDataObject };
					const api = (e.context?.mundoSms ?? {}) as IDataObject;
					const fields: IDataObject = {
						code: api.code ?? null,
						http: api.http ?? null,
						message: api.message ?? e.message,
						detail: api.detail ?? null,
						data: api.data ?? null,
						request_id: api.request_id ?? null,
					};
					const json: IDataObject =
						this.getNode().onError === 'continueErrorOutput'
							? { error: e.message, message: fields.message, details: { ...fields, description: e.description ?? null } }
							: { error: e.message, ...fields, description: e.description ?? null };
					returnData.push({ json, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					// el de la API, con su código HTTP, su message y su detail: se relanza el mismo, con el elemento
					error.context.itemIndex ??= i;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}

/** Una operación de un elemento de entrada: devuelve lo que sale (uno o varios objetos). */
async function executeOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject[]> {
	const param = (name: string, fallback?: unknown) => this.getNodeParameter(name, i, fallback);
	const additionalFields = () => nonEmptyFields(param('additionalFields', {}) as IDataObject, ['number_id']);
	/** Los campos de «Additional Fields» que van en el cuerpo: todos menos la Idempotency Key, que va en su cabecera. */
	const bodyFields = () => {
		const fields = additionalFields();
		delete fields.idempotencyKey;
		return fields;
	};
	/** La Idempotency-Key de un POST de este elemento: la de «Idempotency Key» o la del nodo (la misma en esta ejecución). */
	const postKey = () => idempotencyKey.call(this, i, resource + '.' + operation, additionalFields().idempotencyKey);
	const filters = () => nonEmptyFields(param('filters', {}) as IDataObject, ['number_id']);
	const list = async (path: string) =>
		await mundoSmsList.call(
			this,
			path,
			filters(),
			param('returnAll', false) as boolean,
			param('limit', 50) as number,
			MAX_PAGE_SIZE[path],
			i,
		);
	const request = mundoSmsRequest;

	if (resource === 'account' && operation === 'getBalance') {
		return [toOutput(await request.call(this, 'GET', '/account', {}, undefined, i))];
	}

	if (resource === 'sms') {
		if (operation === 'send') {
			const body = { to: parseNumberList(param('to') as string), text: param('text') as string, ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/sms', {}, body, i, postKey()))];
		}
		if (operation === 'get') {
			const response = await request.call(this, 'GET', '/sms/sends/' + pathId(param('sendId')), {}, undefined, i);
			const sends = ((response.data as IDataObject | undefined)?.sends ?? []) as IDataObject[];
			return [sends.length === 1 ? sends[0] : toOutput(response)];
		}
		if (operation === 'getAll') return await list('/sms');
	}

	if (resource === 'whatsapp') {
		if (operation === 'sendText' || operation === 'sendTemplate') {
			const { header, code, ...rest } = bodyFields();
			const body: IDataObject = { to: (param('to') as string).trim(), ...rest };
			if (operation === 'sendText') {
				body.type = 'text';
				body.text = param('text') as string;
			} else {
				const variables = ((param('variables', {}) as IDataObject).variable ?? []) as IDataObject[];
				const buttons = ((param('buttons', {}) as IDataObject).button ?? []) as IDataObject[];
				const template: IDataObject = {
					name: (param('templateName') as string).trim(),
					language: (param('language', 'es') as string).trim() || 'es',
					vars: variables.map((v) => String(v.value ?? '')),
				};
				if (header !== undefined) template.header = header;
				if (code !== undefined) template.code = code;
				if (buttons.length) {
					template.button_params = buttons.map((b) => ({ index: b.index, [String(b.kind)]: b.value }));
				}
				body.type = 'template';
				body.template = template;
			}
			return [toOutput(await request.call(this, 'POST', '/whatsapp/messages', {}, body, i, postKey()))];
		}
		if (operation === 'get') {
			return [
				toOutput(await request.call(this, 'GET', '/whatsapp/messages/' + pathId(param('messageId')), {}, undefined, i)),
			];
		}
		if (operation === 'getAll') return await list('/whatsapp/messages');
		if (operation === 'getAllOptOuts') return await list('/whatsapp/opt-outs');
		if (operation === 'getOptOut') {
			return [
				toOutput(await request.call(this, 'GET', '/whatsapp/opt-outs/' + pathId(param('optOutId')), {}, undefined, i)),
			];
		}
		if (operation === 'addOptOut') {
			// sin Number ID (0), de todos los números: no se manda
			const body = { contact: text(param('contact')), ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/whatsapp/opt-outs', {}, body, i, postKey()))];
		}
		if (operation === 'removeOptOut') {
			// un DELETE lleva sus parámetros en la query; consent_confirmed solo cuando se confirma
			const qs: IDataObject = { reason: text(param('reason')) };
			if (param('consentConfirmed', false) === true) qs.consent_confirmed = true;
			return [
				toOutput(await request.call(this, 'DELETE', '/whatsapp/opt-outs/' + pathId(param('optOutId')), qs, undefined, i)),
			];
		}
	}

	if (resource === 'call') {
		if (operation === 'getAll') return await list('/calls');
		if (operation === 'getMissed') {
			const response = await request.call(this, 'GET', '/calls/missed', filters(), undefined, i);
			return ((response.data as IDataObject | undefined)?.missed_numbers ?? []) as IDataObject[];
		}
		if (operation === 'dial') {
			const body = { extension: (param('extension') as string).trim(), to: (param('to') as string).trim(), ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/calls', {}, body, i, postKey()))];
		}
	}

	if (resource === 'queue') {
		const queuePath = () => '/queues/' + pathId(param('queueId'));
		if (operation === 'getAll') return await list('/queues');
		if (operation === 'get') return [toOutput(await request.call(this, 'GET', queuePath(), {}, undefined, i))];
		if (operation === 'create') {
			const body = { name: text(param('name')), ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/queues', {}, body, i, postKey()))];
		}
		if (operation === 'update') {
			// solo lo que se cambia: un 0, un false o una lista vacía (Join Empty sin nada) son valores
			const body = nonEmptyFields(param('updateFields', {}) as IDataObject);
			const agents = queueAgents.call(this, i);
			if (agents !== undefined) body.agents = agents;
			return [toOutput(await request.call(this, 'PATCH', queuePath(), {}, body, i))];
		}
		if (operation === 'delete') return [toOutput(await request.call(this, 'DELETE', queuePath(), {}, undefined, i))];
		if (operation === 'getStats') {
			return [toOutput(await request.call(this, 'GET', queuePath() + '/stats', {}, undefined, i))];
		}
		if (operation === 'resetStats') {
			return [toOutput(await request.call(this, 'POST', queuePath() + '/stats/reset', {}, undefined, i, postKey()))];
		}
	}

	if (resource === 'campaign') {
		if (operation === 'create') {
			const body: IDataObject = { to: parseNumberList(param('to') as string), ...bodyFields() };
			if (param('plan', 'diagram') === 'xml') body.xml_plan = param('xmlPlan') as string;
			else body.diagram_id = param('diagramId') as number;
			return [toOutput(await request.call(this, 'POST', '/campaigns', {}, body, i, postKey()))];
		}
		if (operation === 'get') {
			return [toOutput(await request.call(this, 'GET', '/campaigns/' + pathId(param('campaignId')), {}, undefined, i))];
		}
	}

	if (resource === 'numcheck') {
		if (operation === 'check') {
			const body = { number: (param('number') as string).trim(), ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/numchecks', {}, body, i, postKey()))];
		}
		if (operation === 'get') {
			return [toOutput(await request.call(this, 'GET', '/numchecks/' + pathId(param('numcheckId')), {}, undefined, i))];
		}
	}

	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not known for "${resource}"`, {
		itemIndex: i,
	});
}
