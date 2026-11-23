/**
 * La Idempotency-Key de cada POST: la API REST v3 guarda 24 h la respuesta de un POST por su clave, y con la misma clave y
 * la misma petición devuelve esa respuesta («Idempotent-Replayed: true») en vez de volver a hacerlo.
 *
 * Sin una clave propia, la del nodo es la MISMA para el mismo elemento de la misma ejecución: sale de la instancia de n8n, el
 * workflow, la ejecución, el nodo, la vuelta del nodo en esa ejecución (un bucle lo pasa varias veces), el elemento y la
 * operación. Así, «Retry On Fail» (que vuelve a pasar el nodo entero, con todos sus elementos, en la misma ejecución) repite
 * cada envío con su clave y la API no lo hace dos veces; y otra ejecución, o el mismo nodo en otra vuelta del bucle, lleva
 * otra.
 *
 * Ojo al tocarla: el texto que se hashea (las partes en ese orden, unidas por «|») tiene que seguir siendo el mismo. Si cambia,
 * un workflow que se reintente tras actualizar el nodo mandaría otra clave y la API haría el envío otra vez.
 */
import { createHash, randomUUID } from 'crypto';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** La forma que exige la API. */
export const KEY_FORMAT = /^[A-Za-z0-9_.:-]{1,64}$/;

/** El número de vuelta del nodo en esta ejecución: 0 la primera; si n8n no lo da, 0. */
function runIndex(context: IExecuteFunctions, itemIndex: number): number {
	try {
		const value = context.getWorkflowDataProxy(itemIndex).$thisRunIndex;
		return typeof value === 'number' ? value : 0;
	} catch {
		return 0;
	}
}

/**
 * La Idempotency-Key de un POST de este elemento: la tuya (`ownKey`), si la diste (con la forma que pide la API; si no, un
 * error sin mandar nada), o la del nodo, estable para el mismo elemento de la misma ejecución. Sin ejecución (no debería
 * pasar), un UUID nuevo: sigue protegiendo los reintentos de esta llamada.
 */
export function idempotencyKey(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	ownKey: unknown,
): string {
	if (ownKey !== undefined && ownKey !== null && String(ownKey).trim() !== '') {
		const key = String(ownKey).trim();
		if (!KEY_FORMAT.test(key)) {
			throw new NodeOperationError(this.getNode(), 'The Idempotency Key is not valid', {
				itemIndex,
				description: 'It has to be 1 to 64 characters: letters without accents, digits and _ . : -',
			});
		}
		return key;
	}
	const executionId = this.getExecutionId();
	if (!executionId) return randomUUID();
	let instanceId = '';
	let workflowId = '';
	try {
		instanceId = this.getInstanceId() ?? '';
		workflowId = String(this.getWorkflow().id ?? '');
	} catch {
		// sin ellos, la clave sigue siendo única por ejecución, nodo, vuelta y elemento
	}
	const parts = [instanceId, workflowId, executionId, this.getNode().id, runIndex(this, itemIndex), itemIndex, operation];
	return 'n8n-' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
}
