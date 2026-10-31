import test from 'node:test';
import assert from 'node:assert/strict';
import { captureInspectionClip } from './public/camera-clip.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

async function withRecorder({ paint = true, paintDelay = 16, drawMs = 0, plans = [] } = {}, run) {
  const keys = ['document', 'MediaRecorder', 'FileReader', 'performance', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending = new Map();
  let nextId = 0;
  const state = { now: 0, painted: 0, stopped: 0, drawn: 0, attempts: 0, recorders: [], progress: [] };
  const schedule = (callback, delay = 0) => {
    const id = ++nextId;
    pending.set(id, { callback, at: state.now + delay });
    return id;
  };
  const cancel = id => pending.delete(id);
  // Flush promise continuations before advancing time, so an immediate encoder
  // event cannot lose to a watchdog merely because the test uses fake timers.
  state.settle = async promise => {
    let settled = false, value, failure;
    promise.then(result => { value = result; settled = true; }, error => { failure = error; settled = true; });
    for (let step = 0; step < 1000; step++) {
      await turn();
      if (settled) {
        if (failure) throw failure;
        return value;
      }
      const next = [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      assert.ok(next, 'capture stalled without a scheduled event');
      pending.delete(next[0]);
      state.now = Math.max(state.now, next[1].at);
      next[1].callback();
    }
    assert.fail('capture exceeded the bounded virtual scheduling budget');
  };
  state.schedule = schedule;
  const track = { stop() { state.stopped++; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };

  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor(input, options) {
      super();
      this.index = state.attempts++;
      this.plan = plans[this.index] || {};
      if (this.plan.constructorThrows) throw Error('Synthetic recorder constructor failure');
      assert.equal(input, stream);
      assert.match(options.mimeType, /^video\/mp4/);
      this.state = 'inactive';
      this.stopCalls = 0;
      this.listeners = new Map();
      state.recorders.push(this);
    }
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
      super.addEventListener(type, callback, options);
    }
    removeEventListener(type, callback, options) {
      this.listeners.get(type)?.delete(callback);
      super.removeEventListener(type, callback, options);
    }
    emit(type, properties = {}) {
      const event = Object.assign(new Event(type), properties);
      this.dispatchEvent(event);
      this[`on${type}`]?.(event);
    }
    start(timeslice) {
      assert.equal(timeslice, 200);
      this.state = 'recording';
      this.startedAt = state.now;
      if (this.plan.startDelay !== null) {
        this.startTask = schedule(() => this.emit('start'), this.plan.startDelay ?? 0);
      }
    }
    stop() {
      this.stopCalls++;
      cancel(this.startTask);
      if (this.plan.stopThrows) throw Error('Synthetic recorder stop failure');
      this.state = 'inactive';
      this.stoppedAt = state.now;
      this.paintsAtStop = state.painted;
      if (this.plan.stopDelay !== null) schedule(() => {
        this.emit('dataavailable', { data: new Blob([new Uint8Array(128).fill(this.index + 1)]) });
        this.emit('stop');
      }, this.plan.stopDelay ?? 0);
    }
  }
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      }, error => this.onerror(error));
    }
  }
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: () => ({
      getContext: () => ({}),
      toBlob: done => schedule(() => done(new Blob(['poster'], { type: 'image/jpeg' }))),
      captureStream: fps => { assert.equal(fps, 10); return stream; }
    }) } },
    MediaRecorder: { configurable: true, value: Recorder },
    FileReader: { configurable: true, value: Reader },
    performance: { configurable: true, value: { now: () => state.now } },
    setTimeout: { configurable: true, value: schedule },
    clearTimeout: { configurable: true, value: cancel },
    requestAnimationFrame: { configurable: true, value: callback => paint ? schedule(() => { state.painted++; callback(state.now); }, paintDelay) : undefined },
    cancelAnimationFrame: { configurable: true, value: cancel }
  });
  state.capture = options => state.settle(captureInspectionClip(() => { state.drawn++; state.now += drawMs; }, {
    width: 640, height: 320,
    onProgress: fraction => state.progress.push(fraction),
    ...options
  }));
  try {
    await run(state);
    assert.equal(state.stopped, 1, 'the shared capture stream must close exactly once');
    for (const recorder of state.recorders) {
      for (const type of ['start', 'error', 'stop']) {
        assert.equal(recorder.listeners.get(type)?.size ?? 0, 0, `${type} listener leaked`);
      }
    }
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('immediate encoder start wins over watchdog; only the final recorder supplies the clip', async () => {
  await withRecorder({}, async state => {
    const value = await state.capture();
    assert.equal(value.blob.type, 'video/mp4');
    assert.equal(value.blob.size, 128);
    assert.equal(value.poster.type, 'image/jpeg');
    assert.ok([...new Uint8Array(await value.blob.arrayBuffer())].every(byte => byte === 2));
    assert.equal(value.videoDataUrl, `data:video/mp4;base64,${Buffer.alloc(128, 2).toString('base64')}`);
    assert.equal(state.recorders.length, 2);
    assert.deepEqual(state.recorders.map(recorder => recorder.stopCalls), [1, 1]);
    assert.equal(state.progress.length, 16);
    assert.equal(state.painted, 16);
    assert.equal(state.recorders[1].paintsAtStop, 16);
    assert.equal(state.now, 16 * 116);
  });
});

test('a cold primer keeps drawing until start, outside the final recording window', async () => {
  await withRecorder({ plans: [{ startDelay: 2000 }, { startDelay: 32 }] }, async state => {
    const value = await state.capture();
    assert.equal(value.blob.size, 128);
    assert.equal(state.progress.length, 16);
    assert.ok(state.recorders[0].paintsAtStop >= 124, 'primer must paint while the cold encoder starts');
    assert.ok(state.drawn > 18);
    assert.equal(state.now, 2000 + 32 + 16 * 116);
    assert.equal(state.recorders[1].stoppedAt - state.recorders[1].startedAt, 32 + 16 * 116);
  });
});

for (const index of [0, 1]) {
  const phase = index === 0 ? 'primer' : 'final';
  test(`${phase} start timeout is bounded and releases the stream`, async () => {
    const plans = Array.from({ length: index + 1 }, () => ({}));
    plans[index] = { startDelay: null };
    await withRecorder({ plans }, async state => {
      await assert.rejects(state.capture(), /encoder could not start/);
      assert.equal(state.now, 4000);
      assert.equal(state.recorders[index].stopCalls, 1);
    });
  });
  test(`${phase} finish timeout is bounded and releases the stream`, async () => {
    const plans = Array.from({ length: index + 1 }, () => ({}));
    plans[index] = { stopDelay: null };
    await withRecorder({ plans }, async state => {
      await assert.rejects(state.capture(), /encoder did not finish/);
      assert.equal(state.now, 4000 + (index ? 16 * 116 : 0));
    });
  });
  test(`${phase} constructor failure releases the already-created stream`, async () => {
    const plans = Array.from({ length: index + 1 }, () => ({}));
    plans[index] = { constructorThrows: true };
    await withRecorder({ plans }, async state => {
      await assert.rejects(state.capture(), /recorder constructor failure/);
      assert.equal(state.attempts, index + 1);
    });
  });
  test(`${phase} stop throwing still releases the stream`, async () => {
    const plans = Array.from({ length: index + 1 }, () => ({}));
    plans[index] = { stopThrows: true };
    await withRecorder({ plans }, async state => {
      await assert.rejects(state.capture(), /recorder stop failure/);
      assert.equal(state.recorders[index].stopCalls, 2, 'finally retries cleanup without masking the original failure');
    });
  });
  test(`abort while ${phase} start is pending releases the stream`, async () => {
    const plans = Array.from({ length: index + 1 }, () => ({}));
    plans[index] = { startDelay: 500 };
    await withRecorder({ plans }, async state => {
      const controller = new AbortController();
      state.schedule(() => controller.abort(), 25);
      await assert.rejects(state.capture({ signal: controller.signal }), /cancelled/);
      assert.equal(state.now, 25);
      assert.equal(state.progress.length, 0);
    });
  });
}

test('80ms draws shorten the final capture instead of producing an overlong clip', async () => {
  await withRecorder({ drawMs: 80 }, async state => {
    const value = await state.capture();
    const elapsed = state.recorders[1].stoppedAt - state.recorders[1].startedAt;
    assert.equal(value.blob.type, 'video/mp4');
    assert.equal(value.blob.size, 128);
    assert.equal(state.progress.length, 10);
    assert.equal(state.painted, 10);
    assert.equal(elapsed, 10 * (80 + 16 + 100));
    assert.ok(elapsed >= 1800 && elapsed <= 2200);
    assert.equal(state.now, 80 + elapsed, 'poster drawing is outside the recording window');
  });
});

test('delayed paint rejects a recording-window overrun locally and closes the stream', async () => {
  await withRecorder({ paintDelay: 700 }, async state => {
    await assert.rejects(state.capture(), {
      message: 'The camera clip exceeded its local recording window. Take a still photo instead.'
    });
    assert.equal(state.progress.length, 3);
    assert.equal(state.painted, 3);
    assert.equal(state.now, 2400);
    assert.equal(state.recorders[1].stoppedAt, 2400);
  });
});

test('a main-thread stall cannot rewind virtual time or escape the recording-window guard', async () => {
  await withRecorder({}, async state => {
    await assert.rejects(state.capture({ onProgress: fraction => {
      state.progress.push(fraction);
      if (state.progress.length === 1) state.schedule(() => { state.now += 2300; }, 50);
    } }), /exceeded its local recording window/);
    assert.equal(state.progress.length, 1);
    assert.equal(state.now, 2350);
    assert.equal(state.recorders[1].stoppedAt, 2350);
  });
});

test('final encoder preparation is included in the recording-window limit', async () => {
  await withRecorder({ plans: [{}, { startDelay: 2300 }] }, async state => {
    await assert.rejects(state.capture(), /exceeded its local recording window/);
    assert.equal(state.progress.length, 0);
    assert.equal(state.now, 2300);
    assert.equal(state.recorders[1].stoppedAt - state.recorders[1].startedAt, 2300);
  });
});

test('a suspended paint fails after its bounded watchdog and releases the stream', async () => {
  await withRecorder({ paint: false }, async state => {
    await assert.rejects(state.capture(), /stopped updating/);
    assert.equal(state.now, 1500);
    assert.equal(state.progress.length, 1);
  });
});

test('abort during final frames returns no replacement clip and releases the stream', async () => {
  await withRecorder({}, async state => {
    const controller = new AbortController();
    await assert.rejects(state.capture({ signal: controller.signal, onProgress: () => controller.abort() }), /cancelled/);
    assert.equal(state.recorders.length, 2);
    assert.equal(state.now, 0);
  });
});

test('an already-aborted capture releases its stream without starting the primer', async () => {
  await withRecorder({}, async state => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(state.capture({ signal: controller.signal }), /cancelled/);
    assert.equal(state.recorders.length, 1);
    assert.equal(state.recorders[0].state, 'inactive');
    assert.equal(state.recorders[0].stopCalls, 0);
  });
});
