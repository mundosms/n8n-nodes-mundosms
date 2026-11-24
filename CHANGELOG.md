# Changelog

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
