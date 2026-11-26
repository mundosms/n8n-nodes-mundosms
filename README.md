# @mundosms/n8n-nodes-mundosms

This is an n8n community node. It lets you use [MundoSMS](https://www.mundosms.es) in your n8n workflows: send SMS and
WhatsApp messages, keep your WhatsApp opt-outs, read the call history of your PBX, manage its call queues, ring an
extension and call a number (click2dial), launch VozPush campaigns (automated calls) and check mobile numbers (NumCheck).

It calls the [MundoSMS REST API v3](https://www.mundosms.es/api-v3) and signs every request for you (`X-Timestamp` in
milliseconds and the HMAC signature of your API Key), so you do not have to build the signature in a Code node.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Credentials](#credentials) ·
[Compatibility](#compatibility) ·
[Usage](#usage) ·
[Example workflows](#example-workflows) ·
[Resources](#resources)

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
| WhatsApp | Send Text · Send Template · Get (the status of a message) · Get Many (sent and received) · Add Opt-Out · Get Opt-Out · Get Many Opt-Outs · Remove Opt-Out |
| Call | Get Many (call history) · Get Missed (missed calls to return) · Dial (click2dial) |
| Queue | Create · Get · Get Many (with their agents) · Update (options and agents) · Delete · Get Stats · Reset Stats |
| VozPush Campaign | Create · Get |
| NumCheck | Check · Get (the result) |

The "Get Many" operations follow the cursor of the API (`next_cursor`) page by page, repeating the same filters, when you
turn on **Return All**, until `has_more` is false. An empty page with `has_more: true` is not the end: with a filter, the
API sends one after looking at many rows without a match, and the list goes on in the next page.

## Credentials

You need a MundoSMS account and an API key. Create the API key in the MundoSMS control panel, in its API keys section,
and give it the permissions of the operations you will use. `read` covers every query and `write` every action, WhatsApp
included, except the WhatsApp opt-outs: adding and removing them needs `whatsapp` or `whatsapp_optout`, because removing
one is recorded with the API key that did it. `write` does not read, so a workflow that sends and then checks the status
needs both. The description of each operation in the node says its permission; for example, the queues need
`voip_queue_read` to read them and `voip_queue_write` to change them (or `voip`, or `read` and `write`).

In n8n, create a **MundoSMS API** credential with:

- **Token**: the token of the API key (it starts with `eyJ`).
- **Private Key**: the private key shown next to the token in the control panel. It signs each request. Leave it empty
  only if your API key does not require signed requests.
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
- **Sends are not done twice**: every send (SMS, WhatsApp, Dial, VozPush and NumCheck) and every other `POST` (Queue →
  Create and Reset Stats, WhatsApp → Add Opt-Out) carries an `Idempotency-Key` that is the same for each item in the same
  execution. If it is repeated, the API returns the first answer instead of doing it
  again. That covers the node's own retries and **Retry On Fail**, which runs the node again with all its items: the ones
  that already went out are not sent twice. To use your own key (for example, your order ID), set **Idempotency Key** in
  Additional Fields: 1 to 64 letters without accents, digits and `_ . : -`. Then not even another execution sends it
  again within 24 hours.
- **Retries**: the node retries a `429` (nothing was done) and a network failure in any operation, and a send also when the
  API answers `409` with the code `request_in_progress` (the first one with that key has not finished), waiting what
  `Retry-After` says.
  The `5xx` errors are retried only in reads. A send that gets a `5xx` is not repeated by the node: a `500` may come with
  the send already done, and the API keeps it with the `Idempotency-Key`, so repeating it with the same key returns that
  same `500` without doing it again (check whether it went out before sending it with another key); a `503` did nothing
  and can be repeated with the same key, which is what **Retry On Fail** does.
- **Errors** show the `message` of the API, its `detail` and the `X-Request-Id` of the request, which finds it in the
  panel's API logs. With **On Error** → *Continue* (Continue On Fail), the item carries the fields of the API: `code` (a
  word in English, such as `insufficient_credit` or `not_found`: the one to check in an **If** node), `http` (the HTTP
  status; `0` if there was no response), `message`, `detail`, `data` and `request_id`, plus `error` and `description` (the
  texts n8n shows). With *Continue (using error output)*, the item goes out through the error output with `error`,
  `message` and the same fields inside `details` (`{{ $json.details.code }}`): n8n only sends an item to the error output
  when it has nothing else.
- **A successful answer that is not JSON** (the HTML page of a proxy or a captive portal) is an error, not an empty
  success.
- **Queues**: the name of a queue is the one that goes in the destination of a queue in an XML call plan, and it cannot be
  changed later. **Create** makes it with the default options and no agents; then **Update** sets them. A new queue has to
  fit in the queues that your numbers include: if not, the API answers `402` with the code `queue_limit_reached`.
  - **Update** sends only the options you add in **Update Fields**: a `0`, an option turned off or an empty Join Empty
    are values, and they are sent.
  - The agents are replaced as a **whole list**, in its order: the ones you do not send leave the queue. With **Agents** →
    *Keep Current Agents* (the default) they are not touched; with *Replace (Using Fields Below)* or *Replace (Using JSON)*
    the list you give becomes the new one, and an empty list leaves the queue without agents. Each agent is one of your
    extensions (its name) or a phone number; Ring In Use and Wrap-Up Time left as the queue default are sent as `null`.
  - **Delete** does not delete a queue that is in use (in the plan of a number or a diagram, in a VozPush campaign that can
    still call, or in a speed dial): the API answers `409` with the code `queue_in_use` and where it is used in `data`.
  - **Get Stats** gives the counters of the PBX since the last **Reset Stats**, not a history: the call history is in
    Call → Get Many.
- **WhatsApp opt-outs**: an opt-out keeps the contact out of your bulk sends (campaigns) of that number, or of all your
  numbers. A single message (Send Text, Send Template) does not check them: if you use them for reminders, look the
  contact up first with **Get Many Opt-Outs** (filter Contact). **Add Opt-Out** without Number ID opts the contact out of
  all your numbers; adding it again does not create another one (`created` is `false`). **Remove Opt-Out** needs a reason,
  and when the contact asked for the opt-out (`source` `keyword`, because they wrote it, or `blocked`) only remove it with
  their consent and turn on **Consent Confirmed**: without it, the API answers `400` with the code `consent_required`.

## Example workflows

The [`examples`](https://github.com/mundosms/n8n-nodes-mundosms/tree/main/examples) folder of the repository has
workflows ready to import. Download one, and in n8n open a new workflow and choose **Import from File** (or paste its
JSON into the canvas). Then open each MundoSMS node and select your MundoSMS API credential. The examples refer to a
credential named "MundoSMS API": if yours has that name, n8n links it when the workflow is imported or saved. Replace the
example number `34600000000` with yours.

- [`send-sms.json`](https://github.com/mundosms/n8n-nodes-mundosms/blob/main/examples/send-sms.json): a manual trigger
  and **Send SMS** to one number, with the sender (`from`) set in Additional Fields.
- [`whatsapp-template.json`](https://github.com/mundosms/n8n-nodes-mundosms/blob/main/examples/whatsapp-template.json):
  a manual trigger and **Send Template** with three variables (`{{1}}`, `{{2}}`, `{{3}}` of the template body) and your
  own reference (`client_id`). The template has to be approved in WhatsApp: put its name and language.
- [`missed-calls-to-sms.json`](https://github.com/mundosms/n8n-nodes-mundosms/blob/main/examples/missed-calls-to-sms.json):
  every hour, **Get Missed** with From set to one hour ago (the numbers with missed calls that nobody has answered
  since, one item per number), and **Send SMS** to each of them (`{{ $json.number }}`). Activate the workflow to run it
  on schedule.
- [`missed-calls-text-back.json`](https://github.com/mundosms/n8n-nodes-mundosms/blob/main/examples/missed-calls-text-back.json):
  the same, ready to use as a template: a **Settings** node with your sender name and message, a **Filter** that keeps
  only mobile numbers (Spanish mobiles by default, `^34[67]\d{8}$`), and sticky notes that explain each step and the setup.
- [`whatsapp-opt-out-from-crm.json`](https://github.com/mundosms/n8n-nodes-mundosms/blob/main/examples/whatsapp-opt-out-from-crm.json):
  when a customer asks not to receive WhatsApp messages and you write it down in your CRM, the CRM calls a **Webhook** with
  the phone number (`{"phone": "34600000000"}`) and **Add Opt-Out** opts the contact out of all your WhatsApp numbers.
  Its API key needs the permission `whatsapp` or `whatsapp_optout`. Protect the webhook (Header Auth) and activate the
  workflow.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [MundoSMS REST API v3 reference](https://www.mundosms.es/api-v3)
- [MundoSMS SDK for PHP, Python, Node.js, Java, C#, Go and Ruby](https://github.com/mundosms/mundosms-sdk)

## License

[MIT](LICENSE.md)
