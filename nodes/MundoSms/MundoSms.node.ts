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
import { smsDescription } from './descriptions/sms';
import { whatsappDescription } from './descriptions/whatsapp';
import { rfc3986 } from './shared/signing';
import { idempotencyKey } from './shared/idempotency';
import { CREDENTIAL_NAME, mundoSmsList, mundoSmsRequest } from './shared/transport';

/** Lo más que da cada listado por página. */
const MAX_PAGE_SIZE: Record<string, number> = { '/calls': 100, '/sms': 500, '/whatsapp/messages': 500 };

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

/** Un id que va en la ruta, codificado como lo firma la credencial. */
function pathId(value: unknown): string {
	return rfc3986(String(value).trim());
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
		description: 'Send SMS and WhatsApp messages, check calls, launch VozPush campaigns and check numbers with MundoSMS',
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
					returnData.push({
						json: { error: (error as Error).message, description: (error as IDataObject).description ?? null },
						pairedItem: { item: i },
					});
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
					template.buttons = buttons.map((b) => ({ index: b.index, [String(b.kind)]: b.value }));
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
	}

	if (resource === 'call') {
		if (operation === 'getAll') return await list('/calls');
		if (operation === 'getMissed') {
			const response = await request.call(this, 'GET', '/calls/missed', filters(), undefined, i);
			return ((response.data as IDataObject | undefined)?.numbers ?? []) as IDataObject[];
		}
		if (operation === 'dial') {
			const body = { extension: (param('extension') as string).trim(), to: (param('to') as string).trim(), ...bodyFields() };
			return [toOutput(await request.call(this, 'POST', '/calls', {}, body, i, postKey()))];
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
