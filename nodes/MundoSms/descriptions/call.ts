import type { INodeProperties } from 'n8n-workflow';
import { dateField, idempotencyKeyOption, orderOption, pagination } from './common';

const showForDial = { resource: ['call'], operation: ['dial'] };

export const callDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['call'] } },
		options: [
			{
				name: 'Dial',
				value: 'dial',
				action: 'Call a number from an extension',
				description: 'Ring an extension and, when it picks up, call the number (click2dial)',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many calls',
				description: 'Get the call history',
			},
			{
				name: 'Get Missed',
				value: 'getMissed',
				action: 'Get the missed calls to return',
				description: 'Get the numbers with missed calls that nobody has answered since, one per number',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Extension',
		name: 'extension',
		type: 'string',
		required: true,
		default: '',
		description: 'The extension that rings first',
		displayOptions: { show: showForDial },
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'string',
		required: true,
		default: '',
		placeholder: '34600123456',
		description: 'The number to call',
		displayOptions: { show: showForDial },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: showForDial },
		options: [
			{
				displayName: 'Caller ID',
				name: 'from',
				type: 'string',
				default: '',
				description:
					'The number the callee sees. It has to be yours (a DID or a verified number); if not, the one of the extension.',
			},
			{
				displayName: 'Extension Caller ID',
				name: 'extension_caller_id',
				type: 'string',
				default: '',
				description: 'What the extension shows while it rings',
			},
			idempotencyKeyOption,
		],
	},
	...pagination('call'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['call'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'DID',
				name: 'did',
				type: 'string',
				default: '',
				description: 'Incoming: your number they called. Outgoing: the number shown.',
			},
			{
				displayName: 'Extension',
				name: 'extension',
				type: 'string',
				default: '',
				description: 'Outgoing: the extension that called. Incoming: the one that picked up.',
			},
			dateField('From', 'from_datetime', 'Started from this moment (included)'),
			{
				displayName: 'Number',
				name: 'number',
				type: 'string',
				default: '',
				description: 'The calls in which this number is the caller or the callee',
			},
			orderOption,
			{
				displayName: 'Outcome',
				name: 'outcome',
				type: 'options',
				default: 'answered',
				options: [
					{ name: 'Answered', value: 'answered' },
					{ name: 'Missed', value: 'missed' },
				],
				description:
					'Incoming: whether somebody picked it up. Outgoing: whether the callee answered. Not with Type "Function".',
			},
			{
				displayName: 'Stop at Ongoing',
				name: 'stop_at_ongoing',
				type: 'boolean',
				default: false,
				description:
					'Whether to stop before the first call that is still ongoing, so that none is skipped when syncing (oldest first only)',
			},
			dateField('To', 'to_datetime', 'Started before this moment'),
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'all',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Function', value: 'func' },
					{ name: 'Incoming', value: 'in' },
					{ name: 'Outgoing', value: 'out' },
				],
			},
		],
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['call'], operation: ['getMissed'] } },
		options: [
			{
				displayName: 'DID',
				name: 'did',
				type: 'string',
				default: '',
				description: 'Your number they called',
			},
			dateField('From', 'from_datetime', 'From this moment (included). By default, 7 days ago; at most, 31.'),
			{
				displayName: 'Include Returned',
				name: 'include_returned',
				type: 'boolean',
				default: false,
				description: 'Whether to include the numbers that were already answered, with who and how',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 500 },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Number',
				name: 'number',
				type: 'string',
				default: '',
				description: 'A number that called',
			},
			dateField('To', 'to_datetime', 'Before this moment. By default, now.'),
		],
	},
];
