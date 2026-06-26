import type {Benchmark} from './types.js';
import {makeDrawBench} from './benchmarks/draw.js';
import {makeDrawElementsBench} from './benchmarks/drawElements.js';
import {makeDrawInstancedBench} from './benchmarks/drawInstanced.js';
import {makeMultiDrawBench} from './benchmarks/multiDraw.js';
import {makeUniformUpdatesBench} from './benchmarks/uniformUpdates.js';
import {makeUboUpdatesBench} from './benchmarks/uboUpdates.js';
import {makeBindTextureSwitchBench} from './benchmarks/bindTextureSwitch.js';
import {makeUseProgramSwitchBench} from './benchmarks/useProgramSwitch.js';
import {makeBindVAOSwitchBench} from './benchmarks/bindVAOSwitch.js';
import {makeVertexAttribSetupBench} from './benchmarks/vertexAttribSetup.js';
import {makeStateChangeBench} from './benchmarks/stateChange.js';
import {makeViewportScissorBench} from './benchmarks/viewportScissor.js';
import {makeFboSwitchBench} from './benchmarks/fboSwitch.js';
import {
  makeBufferSubDataSmallBench,
  makeBufferSubDataBigBench,
} from './benchmarks/bufferSubData.js';
import {
  makeTexSubImageSmallBench,
  makeTexSubImageBigBench,
} from './benchmarks/texSubImage.js';
import {makeTexImageFromDOMBench} from './benchmarks/texImageFromDOM.js';
import {makeReadPixelsSyncBench} from './benchmarks/readPixelsSync.js';
import {makeSyncRoundTripBench} from './benchmarks/syncRoundTrip.js';

// Benchmarks grouped for display; order here is the order shown and run.
export interface BenchGroup {
  title: string;
  factories: Array<() => Benchmark>;
}

export const GROUPS: BenchGroup[] = [
  {
    title: 'Draw-call overhead',
    factories: [
      makeDrawBench,
      makeDrawElementsBench,
      makeDrawInstancedBench,
      makeMultiDrawBench,
    ],
  },
  {
    title: 'State-change overhead',
    factories: [
      makeUniformUpdatesBench,
      makeUboUpdatesBench,
      makeBindTextureSwitchBench,
      makeUseProgramSwitchBench,
      makeBindVAOSwitchBench,
      makeVertexAttribSetupBench,
      makeStateChangeBench,
      makeViewportScissorBench,
    ],
  },
  {
    title: 'Render-target / pass overhead',
    factories: [makeFboSwitchBench],
  },
  {
    title: 'Data upload',
    factories: [
      makeBufferSubDataSmallBench,
      makeBufferSubDataBigBench,
      makeTexSubImageSmallBench,
      makeTexSubImageBigBench,
      makeTexImageFromDOMBench,
    ],
  },
  {
    title: 'Synchronous round-trips',
    factories: [makeReadPixelsSyncBench, makeSyncRoundTripBench],
  },
];

// Flat list of fresh benchmark instances, in display order.
export function createAllBenchmarks(): Benchmark[] {
  return GROUPS.flatMap(g => g.factories.map(f => f()));
}

// Group title for a given benchmark id (for the UI).
export function groupTitleFor(id: string): string {
  for (const g of GROUPS) {
    for (const f of g.factories) {
      if (f().id === id) return g.title;
    }
  }
  return '';
}

export const ALL_IDS: string[] = createAllBenchmarks().map(b => b.id);
