import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';
import { DEFAULT_BASE_URL, signRequest } from '../nodes/MundoSms/shared/signing';

/**
 * La API Key de MundoSMS: el token y la clave privada con la que se firma cada petición. La firma (HMAC-SHA256 de la ruta,
 * la query, el cuerpo y la hora) no se puede declarar: la calcula `authenticate`, así que vale para el nodo MundoSMS, para
 * la prueba de la credencial y para el nodo HTTP Request con esta credencial.
 */
export class MundoSmsApi implements ICredentialType {
	name = 'mundoSmsApi';

	displayName = 'MundoSMS API';

	icon: Icon = { light: 'file:../icons/mundosms.svg', dark: 'file:../icons/mundosms.dark.svg' };

	documentationUrl = 'https://www.mundosms.es/api-v3#autenticacion-y-firma';

	properties: INodeProperties[] = [
		{
			displayName: 'Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'The Token of your API Key (it starts with eyJ). Create it in the MundoSMS panel, in API y Soporte → Claves de API.',
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The private key of the API Key (button "Mostrar"), used to sign each request. Leave it empty only if your API Key does not require signed requests.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: DEFAULT_BASE_URL,
		},
	];

	authenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => await signRequest(credentials, requestOptions);

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/account',
			method: 'GET',
		},
	};
}
