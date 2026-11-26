# Changelog

## 1.0.5

- **New resource: Queue**, the call queues of your PBX (API key permission `voip_queue_read` to read them and
  `voip_queue_write` to change them, or `voip`, or `read` and `write`):
  - Get Many (with Return All by cursor and the filters Agent, Name and Order) and Get, each queue with its options and its
    agents;
  - Create, with the default options and no agents (only the name, which cannot be changed later);
  - Update: the options in Update Fields (only the ones you add are sent) and the agents, which the API replaces as a whole
    list, in order. Agents → Keep Current Agents (the default) does not touch them; Replace (Using Fields Below) or Replace
    (Using JSON) sends the new list, and an empty list leaves the queue without agents;
  - Delete (a queue in use answers `409` with the code `queue_in_use` and where it is used in `data`);
  - Get Stats (calls waiting, answered and abandoned, service level and the state of each agent) and Reset Stats.
- **WhatsApp opt-outs**, the contacts who asked not to receive your messages (they stay out of your bulk sends):
  - Get Many Opt-Outs (with Return All by cursor and the filters Contact, Number ID and Order) and Get Opt-Out (API key
    permission `whatsapp_read`, or `whatsapp` or `read`);
  - Add Opt-Out, from one of your numbers (Number ID) or from all of them, and Remove Opt-Out, with a reason and, when the
    contact asked for the opt-out, Consent Confirmed. Both need the permission `whatsapp_optout` or `whatsapp`: `write`
    does not include them.
- The description of each new operation says the permission its API key needs.
- A new example workflow, `whatsapp-opt-out-from-crm.json`: your CRM calls a webhook with a phone number and the contact is
  opted out of your WhatsApp numbers.

## 1.0.4

- **Continue On Fail and the error output keep the fields of the API.** With On Error → *Continue*, the item of a failed
  operation carries `code` (the word that says what failed: `insufficient_credit`, `not_found`,
  `whatsapp_window_closed`…), `http` (the HTTP status, `0` if there was no response), `message`, `detail`, `data` and
  `request_id`, besides `error` and `description`. Up to 1.0.3 it carried only `error` and `description`, so a workflow
  could not tell one error from another.
- **The error output works.** With On Error → *Continue (using error output)*, a failed item now goes out through the
  error output, with `error`, `message` and the fields of the API inside `details` (`details.code`, `details.http`…): n8n
  only sends an item there when it has nothing else. Up to 1.0.3, because of its `description`, it went out through the
  normal output, as if it had worked.
- **A successful answer that is not JSON is an error.** The HTML page of a proxy or a captive portal with a `200` used to
  come out as an empty success (`{"status": "success", "message": "OK"}`); now it fails with `HTTP 200: the response is
  not JSON (text/html)`, like in the SDKs. An empty answer is still a success.
- The README said that the API does not keep the `5xx` errors of a send. It keeps the `500`, which may come with the send
  already done: repeating it with the same `Idempotency-Key` returns that same `500` without doing it again. A `503` did
  nothing and can be repeated with the same key. The node does the same as before: it does not repeat a send with a `5xx`.
- The README links the SDK in its seven languages (PHP, Python, Node.js, Java, C#, Go and Ruby).

## 1.0.3

- Get Many with Return All (calls, SMS, WhatsApp messages): an empty page with `has_more: true` is no longer the end of
  the list. The API sends one when a filter has looked at many rows without a match (with Stop at Ongoing and Outcome,
  or Extension on incoming calls, after 5,000 rows read), and its `next_cursor` moves on. Up to 1.0.2 the node stopped
  there and returned the list cut short, without any error. Now it ends, like the SDKs, when `has_more` is false (also
  on the page that stops at an ongoing call), when there is no `next_cursor`, when `data.ongoing_call` comes, or when
  the cursor does not move.
- Follows the new error format of the API: every error carries `code`, a word in English (`not_found`,
  `insufficient_credit`, `duplicated_request`…), and no response carries `status_code` any more. A `409` is retried by its
  `code` (`duplicated_request`, or `request_in_progress` on a send), not by the text of its message: the same requests are
  retried as before. An empty successful answer comes out as `{"status": "success", "message": "OK"}`, without the
  `"status_code": "0"` the node added.

## 1.0.2

- WhatsApp → Send Template: the values of the template buttons go in `template.button_params`, the name the API expects
  now. With `template.buttons` the API answers `400` (`buttons` is the message type with reply buttons, and the
  definition of the buttons in the list of templates).

## 1.0.1

- The credential and the README are in English only.
- Example workflows in the `examples` folder of the repository: send an SMS, send a WhatsApp template and text back the
  missed calls of the last hour. The README explains them.
- Call → Get Missed: it returned no items, because the API lists the numbers in `data.missed_numbers`.
- Call → Get Many: the filter "Status" is now "Outcome" (`outcome`, answered or missed), the name the API expects. With
  "Status" the API answered `400`.
- The descriptions of Client ID say the limit of the API: 50 characters.

## 1.0.0

First version: the MundoSMS node and the MundoSMS API credential.

- Account: get balance.
- SMS: send, get the status of a send, get many (with Return All by cursor).
- WhatsApp: send text, send template (variables, header text, buttons and code), get the status of a message, get many.
- Call: get many (call history), get missed, dial (click2dial).
- VozPush campaign: create (diagram or XML plan), get.
- NumCheck: check a number, get the result.
- Every request signed by the credential (also its test and the HTTP Request node), retries only of what is safe to repeat.
- Every send carries an `Idempotency-Key`, the same for each item in the same execution, so that the node's retries and
  Retry On Fail do not send anything twice. Your own key in Additional Fields → Idempotency Key.
