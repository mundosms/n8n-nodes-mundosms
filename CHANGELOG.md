# Changelog

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
