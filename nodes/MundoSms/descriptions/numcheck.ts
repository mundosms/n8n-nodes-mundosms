import type { INodeProperties } from 'n8n-workflow';
import { idempotencyKeyOption } from './common';

export const numcheckDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['numcheck'] } },
		options: [
			{
				name: 'Check',
				value: 'check',
				action: 'Check a mobile number',
				description:
					'Check whether a mobile exists, is on and which operator it is with, without calling it. The result comes a few seconds later.',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get the result of a number check',
				description: 'Get a check and its result',
			},
		],
		default: 'check',
	},
	{
		displayName: 'Number',
		name: 'number',
		type: 'string',
		required: true,
		default: '',
		placeholder: '34600123456',
		description: 'The mobile number, with its country code',
		displayOptions: { show: { resource: ['numcheck'], operation: ['check'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['numcheck'], operation: ['check'] } },
		options: [
			{
				displayName: 'Callback URL',
				name: 'callback_url',
				type: 'string',
				default: '',
				description: 'Your public URL that receives the result',
			},
			{
				displayName: 'Client ID',
				name: 'client_id',
				type: 'string',
				default: '',
				description: 'Your reference, up to 50 characters',
			},
			idempotencyKeyOption,
		],
	},
	{
		displayName: 'Check ID',
		name: 'numcheckId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID returned when the check was requested',
		displayOptions: { show: { resource: ['numcheck'], operation: ['get'] } },
	},
];
