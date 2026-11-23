# @mundosms/n8n-nodes-mundosms

This is an n8n community node. It lets you use [MundoSMS](https://www.mundosms.es) in your n8n workflows: send SMS and
WhatsApp messages, read the call history of your PBX, ring an extension and call a number (click2dial), launch VozPush
campaigns (automated calls) and check mobile numbers (NumCheck).

It calls the [MundoSMS REST API v3](https://www.mundosms.es/api-v3) and signs every request for you (`X-Timestamp` in
milliseconds and the HMAC signature of your API Key), so you do not have to build the signature in a Code node.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Credentials](#credentials) ·
[Compatibility](#compatibility) ·
[Usage](#usage) ·
[Resources](#resources) ·
[En español](#en-español)

## Installation

The package name is `@mundosms/n8n-nodes-mundosms`.

In n8n, go to **Settings → Community Nodes → Install**, enter `@mundosms/n8n-nodes-mundosms` and confirm. The node
appears as **MundoSMS** in the nodes panel. See the
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes
documentation for other ways to install it (for example, with npm in a self-hosted n8n).

## Operations

| Resource | Operations |
|---|---|
| Account | Get Balance |
| SMS | Send · Get (the status of a send) · Get Many (the sent SMS, one per recipient) |
| WhatsApp | Send Text · Send Template · Get (the status of a message) · Get Many (sent and received) |
| Call | Get Many (call history) · Get Missed (missed calls to return) · Dial (click2dial) |
| VozPush Campaign | Create · Get |
| NumCheck | Check · Get (the result) |

The "Get Many" operations follow the cursor of the API (`next_cursor`) page by page, repeating the same filters, when you
turn on **Return All**.

## Credentials

You need a MundoSMS account and an API Key. Create it in the MundoSMS panel, in **API y Soporte → Claves de API**, and
give it the permissions of the operations you will use (WhatsApp needs the `whatsapp` permission: the generic `read` and
`write` do not include it).

In n8n, create a **MundoSMS API** credential with:

- **Token**: the Token of the API Key (it starts with `eyJ`).
- **Private Key**: its private key (button «Mostrar»). Leave it empty only if your API Key does not require signed
  requests.
- **Base URL**: `https://api.mundosms.es/v3` (leave it as it is).

The credential test calls `GET /v3/account`. The signature is computed by the credential itself, so it also works with the
**HTTP Request** node (Authentication → Predefined Credential Type → MundoSMS API) for any route this node does not cover.

## Compatibility

Tested with n8n 2.46.6. No dependencies besides n8n itself.

## Usage

- **Phone numbers** go with their country code and only digits: `34600123456`. In "To", several numbers are separated by
  commas.
- **Dates** (Scheduled Date, From, To) are Madrid time unless they carry their time zone.
- **WhatsApp not confirmed**: if WhatsApp does not answer, the API replies `202` with `"status": "success"`,
  `data.state` `"unknown"` and the message `id` in `data.id`: the message **may have been sent**. It is the node's
  output, not an error, so "Retry On Fail" does not send the message twice. Do not send it again.
- **Sends are not done twice**: every send (SMS, WhatsApp, Dial, VozPush and NumCheck) carries an `Idempotency-Key` that is
  the same for each item in the same execution. If it is repeated, the API returns the first answer instead of doing it
  again. That covers the node's own retries and **Retry On Fail**, which runs the node again with all its items: the ones
  that already went out are not sent twice. To use your own key (for example, your order ID), set **Idempotency Key** in
  Additional Fields: 1 to 64 letters without accents, digits and `_ . : -`. Then not even another execution sends it
  again within 24 hours.
- **Retries**: the node retries a `429` (nothing was done) and a network failure in any operation, and a send also when the
  API answers `409 Request in progress` (the first one with that key has not finished), waiting what `Retry-After` says.
  The `5xx` errors are retried only in reads: the API does not keep them, so repeating a send would do it again.
- **Errors** show the `message` of the API, its `detail` and the `X-Request-Id` of the request, which finds it in the
  panel's API logs.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [MundoSMS REST API v3 reference](https://www.mundosms.es/api-v3)
- [MundoSMS SDK for PHP, Python and Node.js](https://github.com/mundosms/mundosms-sdk)

## En español

Nodo de comunidad de n8n para la [API REST v3 de MundoSMS](https://www.mundosms.es/api-v3): SMS, WhatsApp, historial de
llamadas, llamadas perdidas, click2dial, campañas de VozPush, NumCheck y saldo. Firma cada petición por ti.

- **Instalación**: en n8n, **Settings → Community Nodes → Install**, con el nombre `@mundosms/n8n-nodes-mundosms`.
- **Credencial «MundoSMS API»**: el Token y la clave privada de una API Key creada en el panel (**API y Soporte → Claves
  de API**). La prueba de la credencial pide `GET /v3/account`. Vale también para el nodo **HTTP Request** (credencial
  predefinida), que firma igual.
- **WhatsApp sin confirmar** (HTTP 202, `data.state` `"unknown"`): WhatsApp no contestó y el mensaje **puede haber
  salido**. Es la salida del nodo, no un error, así que «Retry On Fail» no lo manda dos veces. No lo reenvíes.
- **Los envíos no salen dos veces**: cada envío lleva una `Idempotency-Key`, la misma para cada elemento en la misma
  ejecución, y la API no lo vuelve a hacer si se repite: vale para los reintentos del nodo y para «Retry On Fail». Para usar
  la tuya (el id de tu pedido, por ejemplo), rellena **Idempotency Key** en «Additional Fields»: así tampoco sale dos veces
  en otra ejecución, en 24 horas.
- **Reintentos**: el nodo reintenta un `429` y un fallo de red en cualquier operación, y un envío también ante un
  `409 Request in progress`. Los `5xx`, solo en las consultas.

## License

[MIT](LICENSE.md)
