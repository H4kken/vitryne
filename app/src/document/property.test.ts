// SPDX-License-Identifier: AGPL-3.0-or-later
// Random edit sessions on the three examples, against the worker's real Rust (Node build):
// after every step the document Rust holds matches the UI's, every state the UI accepts Rust
// accepts too, and undoing everything saves the original file byte for byte.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, openExample } from '@/test/rust';
import {
  type Command,
  CommandError,
  FABRIC_FIELDS,
  type FabricField,
  renameCut,
  renameFabric,
  renamePiece,
  renameProject,
  renameSeam,
  setFabricValue,
  setSelfCollision,
  setTargetVertices,
} from './commands';
import { type Entities, mainGarment } from './entities';
import { DocumentStore } from './store';

type Step =
  | { op: 'fabric'; field: FabricField; value: number; gesture: boolean }
  | { op: 'rename'; what: 'project' | 'piece' | 'cut' | 'seam' | 'fabric'; index: number; name: string }
  | { op: 'vertices'; value: number }
  | { op: 'selfCollision'; on: boolean }
  | { op: 'undo' }
  | { op: 'redo' };

const number = fc.oneof(
  fc.double({ min: -10, max: 1e5, noNaN: false }),
  fc.constantFrom(0, -0, 1e-9, 0.15, 1, Number.NaN, Number.POSITIVE_INFINITY),
);

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constant('fabric' as const), field: fc.constantFrom(...(Object.keys(FABRIC_FIELDS) as FabricField[])), value: number, gesture: fc.boolean() }),
  fc.record({
    op: fc.constant('rename' as const),
    what: fc.constantFrom('project' as const, 'piece' as const, 'cut' as const, 'seam' as const, 'fabric' as const),
    index: fc.nat(20),
    name: fc.string({ maxLength: 12 }),
  }),
  fc.record({ op: fc.constant('vertices' as const), value: fc.oneof(fc.integer({ min: -10, max: 40_000 }), fc.double({ min: 0, max: 1e4 })) }),
  fc.record({ op: fc.constant('selfCollision' as const), on: fc.boolean() }),
  fc.constant({ op: 'undo' as const }),
  fc.constant({ op: 'redo' as const }),
);

function build(s: Step, e: Entities): Command {
  const g = mainGarment(e)!;
  const fabric = e.fabrics[0]!.id;
  switch (s.op) {
    case 'fabric':
      return setFabricValue(e, fabric, s.field, s.value);
    case 'vertices':
      return setTargetVertices(e, s.value);
    case 'selfCollision':
      return setSelfCollision(e, s.on);
    case 'rename': {
      const piece = g.pieces[s.index % g.pieces.length]!;
      switch (s.what) {
        case 'project':
          return renameProject(e, s.name);
        case 'piece':
          return renamePiece(e, g.id, piece.id, s.name);
        case 'cut':
          return renameCut(e, g.id, piece.id, piece.cuts[s.index % piece.cuts.length]!.id, s.name);
        case 'seam': {
          const seams = g.seams ?? [];
          if (!seams.length) throw new CommandError('no seams');
          return renameSeam(e, g.id, seams[s.index % seams.length]!.id, s.name);
        }
        case 'fabric':
          return renameFabric(e, fabric, s.name);
      }
    }
  }
  throw new Error('unreachable');
}

describe.each(EXAMPLES)('%s: random edit sessions', (name) => {
  it('stay valid in Rust and undo back to the original bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 25 }), async (steps) => {
        const { file, zip, entities } = openExample(name);
        let refusedByRust: string | null = null;
        const store = new DocumentStore(
          {
            // The worker's update, synchronously: Rust validates and takes the state.
            update: async (_rev, json) => {
              try {
                file.set_entities(json);
              } catch (e) {
                refusedByRust = String(e);
                throw new Error(String(e), { cause: e });
              }
              return { warnings: [] };
            },
            drape: () => {},
            onReopened: () => {},
          },
          { freeze: true, drapeDelayMs: 1e9 },
        );
        store.load(`${name}.vtry`, entities, [], 0);
        for (const s of steps) {
          if (s.op === 'undo') store.undo();
          else if (s.op === 'redo') store.redo();
          else {
            if (s.op === 'fabric' && s.gesture) store.beginGesture(`fabric:${entities.fabrics[0]!.id}:${s.field}`);
            store.execute((e) => build(s, e));
            if (s.op === 'fabric' && !s.gesture) store.endGesture();
          }
          const { entities: confirmed } = await store.settled();
          // Everything the UI let through, Rust accepted.
          expect(refusedByRust).toBeNull();
          // Rust holds exactly the UI's document.
          expect(JSON.parse(file.entities())).toEqual(JSON.parse(JSON.stringify(confirmed)));
          expect(confirmed).toBe(store.state.entities);
        }
        while (store.state.undoLabel) store.undo();
        await store.settled();
        expect(store.state.dirty).toBe(false);
        expect(Buffer.from(file.save()).equals(Buffer.from(zip))).toBe(true);
        file.free();
      }),
      { numRuns: 40 },
    );
  });
});
