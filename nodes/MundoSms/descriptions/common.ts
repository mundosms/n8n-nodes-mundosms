import type { INodeProperties } from 'n8n-workflow';

/** «Return All» y «Limit» de un listado por cursor (operación getAll del recurso). */
export function pagination(resource: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show: { resource: [resource], operation: ['getAll'] } },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			description: 'Max number of results to return',
			displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
		},
	];
}

export const orderOption: INodeProperties = {
	displayName: 'Order',
	name: 'order',
	type: 'options',
	default: 'desc',
	options: [
		{ name: 'Newest First', value: 'desc' },
		{ name: 'Oldest First', value: 'asc' },
	],
	description:
		'Sort order. Without it, the newest first, or the oldest first when "From" is set.',
};

/**
 * La Idempotency-Key propia de un POST, en «Additional Fields» de cada envío. Sin ella, el nodo usa una que es la misma para
 * el mismo elemento de la misma ejecución (shared/idempotency.ts).
 */
export const idempotencyKeyOption: INodeProperties = {
	displayName: 'Idempotency Key',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	placeholder: 'order-881',
	description:
		'Your own key, so that repeating this request within 24 hours does not do it again (for example, your order ID): 1 to 64 letters without accents, digits and _ . : -. Without it, the node uses one that is the same for each item in the same execution, so Retry On Fail does not send anything twice.',
};

export function dateField(displayName: string, name: string, description: string): INodeProperties {
	return { displayName, name, type: 'dateTime', default: '', description };
}
