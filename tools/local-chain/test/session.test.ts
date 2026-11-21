// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { stopAll } from '../src/session.js';

describe('stopping what a chain test started', () => {
  it('stops the last thing started first', async () => {
    const order: string[] = [];
    await stopAll([() => order.push('chain'), () => order.push('wallet')]);
    expect(order).toEqual(['wallet', 'chain']);
  });

  it('still stops the chain when stopping the wallet throws, then names the failure', async () => {
    const order: string[] = [];
    const stopping = stopAll([
      () => order.push('chain'),
      () => {
        throw new Error('the wallet would not stop');
      },
    ]);
    await expect(stopping).rejects.toThrow('could not stop everything the tests started');
    await stopping.catch((error: unknown) => {
      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
        'the wallet would not stop',
      ]);
    });
    expect(order).toEqual(['chain']);
  });

  it('does nothing when nothing was started', async () => {
    await expect(stopAll([])).resolves.toBeUndefined();
  });
});
