import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk';
import { SorobanSpec } from '../src/contract/spec';
import { generateTypeScriptBindings } from '../src/contract/bindings';
import { TrustFlowError } from '../src/errors';

// Real `xdr` objects only — `@stellar/stellar-sdk` is intentionally not mocked
// here so these tests exercise the actual spec accessors.

const t = {
  u32: () => xdr.ScSpecTypeDef.scSpecTypeU32(),
  string: () => xdr.ScSpecTypeDef.scSpecTypeString(),
  timepoint: () => xdr.ScSpecTypeDef.scSpecTypeTimepoint(),
  duration: () => xdr.ScSpecTypeDef.scSpecTypeDuration(),
  u128: () => xdr.ScSpecTypeDef.scSpecTypeU128(),
  i128: () => xdr.ScSpecTypeDef.scSpecTypeI128(),
  i32: () => xdr.ScSpecTypeDef.scSpecTypeI32(),
  u64: () => xdr.ScSpecTypeDef.scSpecTypeU64(),
  i64: () => xdr.ScSpecTypeDef.scSpecTypeI64(),
  bool: () => xdr.ScSpecTypeDef.scSpecTypeBool(),
  bytes: () => xdr.ScSpecTypeDef.scSpecTypeBytes(),
  symbol: () => xdr.ScSpecTypeDef.scSpecTypeSymbol(),
  address: () => xdr.ScSpecTypeDef.scSpecTypeAddress(),
  bytesN: (n: number) =>
    xdr.ScSpecTypeDef.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n })),
  option: (valueType: xdr.ScSpecTypeDef) =>
    xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({ valueType })),
  vec: (elementType: xdr.ScSpecTypeDef) =>
    xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({ elementType })),
  map: (keyType: xdr.ScSpecTypeDef, valueType: xdr.ScSpecTypeDef) =>
    xdr.ScSpecTypeDef.scSpecTypeMap(new xdr.ScSpecTypeMap({ keyType, valueType })),
  tuple: (valueTypes: xdr.ScSpecTypeDef[]) =>
    xdr.ScSpecTypeDef.scSpecTypeTuple(new xdr.ScSpecTypeTuple({ valueTypes })),
  udt: (name: string) =>
    xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name })),
};

function structEntry(
  name: string,
  fields: { name: string; type: xdr.ScSpecTypeDef }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: fields.map(
        (f) => new xdr.ScSpecUdtStructFieldV0({ doc: '', name: f.name, type: f.type }),
      ),
    }),
  );
}

const VALID_ADDRESS = Keypair.random().publicKey();

/** Runs `fn` and returns the thrown value (or undefined if nothing was thrown). */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

function expectInvalid(fn: () => unknown, ...fragments: string[]): void {
  const err = catchError(fn);
  expect(err).toBeInstanceOf(TrustFlowError);
  expect((err as TrustFlowError).code).toBe('INVALID_CONTRACT_CALL');
  for (const fragment of fragments) {
    expect((err as TrustFlowError).message).toContain(fragment);
  }
}

function voidCase(name: string): xdr.ScSpecUdtUnionCaseV0 {
  return xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
    new xdr.ScSpecUdtUnionCaseVoidV0({ doc: `${name} doc`, name }),
  );
}

function tupleCase(name: string, types: xdr.ScSpecTypeDef[]): xdr.ScSpecUdtUnionCaseV0 {
  return xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
    new xdr.ScSpecUdtUnionCaseTupleV0({ doc: `${name} doc`, name, type: types }),
  );
}

function unionEntry(name: string, cases: xdr.ScSpecUdtUnionCaseV0[]): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
    new xdr.ScSpecUdtUnionV0({ doc: 'a union', lib: 'lib', name, cases }),
  );
}

function fnEntry(
  name: string,
  inputs: { name: string; type: xdr.ScSpecTypeDef }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: '',
      name,
      inputs: inputs.map(
        (i) => new xdr.ScSpecFunctionInputV0({ doc: '', name: i.name, type: i.type }),
      ),
      outputs: [],
    }),
  );
}

describe('SorobanSpec union types (#263)', () => {
  it('indexes a union with a void case and a tuple case', () => {
    const entry = unionEntry('Choice', [
      voidCase('None'),
      tupleCase('Some', [t.u32(), t.string()]),
    ]);

    const spec = new SorobanSpec([entry]);

    const union = spec.unions.get('Choice');
    expect(union).toBeDefined();
    expect(union?.doc).toBe('a union');
    expect(union?.lib).toBe('lib');
    expect(union?.cases.map((c) => c.name)).toEqual(['None', 'Some']);

    const [none, some] = union!.cases;
    expect(none.doc).toBe('None doc');
    expect(none.typeList).toBeUndefined();
    expect(some.doc).toBe('Some doc');
    expect(some.typeList?.map((ty) => ty.switch().name)).toEqual([
      'scSpecTypeU32',
      'scSpecTypeString',
    ]);
  });

  it('indexes unions alongside functions in the same spec', () => {
    const spec = new SorobanSpec([
      unionEntry('Choice', [voidCase('None')]),
      fnEntry('ping', []),
    ]);

    expect(spec.unions.has('Choice')).toBe(true);
    expect(spec.getFunction('ping')).toBeDefined();
  });

  it('round-trips a union entry supplied as a base64 string and as a Buffer', () => {
    const entry = unionEntry('Choice', [voidCase('None'), tupleCase('Some', [t.u32()])]);

    const fromBase64 = new SorobanSpec([entry.toXDR('base64')]);
    const fromBuffer = new SorobanSpec([entry.toXDR()]);

    expect(fromBase64.unions.get('Choice')?.cases.map((c) => c.name)).toEqual(['None', 'Some']);
    expect(fromBuffer.unions.get('Choice')?.cases.map((c) => c.name)).toEqual(['None', 'Some']);
  });
});

describe('SorobanSpec entry parsing (#263)', () => {
  const validEntry = () => fnEntry('ping', []);

  it.each<[string, unknown]>([
    ['a number', 42],
    ['a plain object', { name: 'ping' }],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
  ])('throws a TrustFlowError naming the index for %s', (_label, bad) => {
    let caught: unknown;
    try {
      new SorobanSpec([validEntry(), bad as never]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TrustFlowError);
    expect((caught as TrustFlowError).code).toBe('INVALID_CONTRACT_CALL');
    expect((caught as TrustFlowError).message).toContain('index 1');
  });

  it('wraps an undecodable string in a TrustFlowError naming the index', () => {
    let caught: unknown;
    try {
      new SorobanSpec(['not-valid-xdr']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TrustFlowError);
    expect((caught as TrustFlowError).code).toBe('INVALID_CONTRACT_CALL');
    expect((caught as TrustFlowError).message).toContain('index 0');
  });

  it('accepts a duck-typed entry that exposes toXDR() (e.g. from a second stellar-sdk copy)', () => {
    const real = validEntry();
    const foreign = { toXDR: () => real.toXDR() };

    const spec = new SorobanSpec([foreign as never]);

    expect(spec.getFunction('ping')).toBeDefined();
  });

  it('still accepts real ScSpecEntry objects, base64 strings, hex strings and Buffers', () => {
    const entry = validEntry();

    const spec = new SorobanSpec([
      entry,
      fnEntry('b64', []).toXDR('base64'),
      fnEntry('hex', []).toXDR('hex'),
      fnEntry('raw', []).toXDR(),
    ]);

    expect([...spec.functions.keys()]).toEqual(['ping', 'b64', 'hex', 'raw']);
  });
});

describe('SorobanSpec u128 / duration / timepoint encoding (#264)', () => {
  const spec = new SorobanSpec([
    fnEntry('schedule', [
      { name: 'at', type: t.timepoint() },
      { name: 'window', type: t.duration() },
      { name: 'amount', type: t.u128() },
    ]),
  ]);

  it('emits scvTimepoint, scvDuration and scvU128 for the three spec types', () => {
    const scVals = spec.encodeArgs('schedule', [5, 6, 7]);

    expect(scVals.map((v) => v.switch().name)).toEqual(['scvTimepoint', 'scvDuration', 'scvU128']);
  });

  it('encodes a u128 in [2^127, 2^128) without error and without losing precision', () => {
    for (const big of [2n ** 127n, 2n ** 127n + 12345n, 2n ** 128n - 1n]) {
      const [, , amount] = spec.encodeArgs('schedule', [1n, 1n, big]);

      expect(amount.switch().name).toBe('scvU128');
      expect(scValToNative(amount)).toBe(big);
    }
  });

  it('encodes each type through the named-argument form too', () => {
    const scVals = spec.encodeArgs('schedule', { at: 5n, window: 6n, amount: 7n });

    expect(scVals.map((v) => v.switch().name)).toEqual(['scvTimepoint', 'scvDuration', 'scvU128']);
  });

  it('still encodes i128 as scvI128', () => {
    const i128Spec = new SorobanSpec([fnEntry('f', [{ name: 'a', type: t.i128() }])]);

    expect(i128Spec.encodeArgs('f', [-5n])[0].switch().name).toBe('scvI128');
  });

  it('decodeReturnValue round-trips timepoint, duration and u128 values', () => {
    const values: [string, bigint][] = [
      ['scvTimepoint', 1_700_000_000n],
      ['scvDuration', 3_600n],
      ['scvU128', 2n ** 127n + 9n],
    ];
    const encoded = spec.encodeArgs('schedule', values.map(([, v]) => v));

    encoded.forEach((scVal, i) => {
      expect(scVal.switch().name).toBe(values[i][0]);
      expect(spec.decodeReturnValue('schedule', scVal)).toBe(values[i][1]);
    });
  });
});

describe('generateTypeScriptBindings timepoint mapping (#264)', () => {
  it('maps timepoint and duration arguments to bigint instead of unknown', () => {
    const code = generateTypeScriptBindings(
      [
        fnEntry('schedule', [
          { name: 'at', type: t.timepoint() },
          { name: 'window', type: t.duration() },
        ]),
      ],
      { className: 'ScheduleClient' },
    );

    expect(code).toContain('{ at: bigint; window: bigint }');
  });
});

describe('SorobanSpec.encodeArgs named-argument validation (#265)', () => {
  const spec = new SorobanSpec([
    fnEntry('transfer', [
      { name: 'memo', type: t.string() },
      { name: 'flag', type: t.bool() },
      { name: 'note', type: t.option(t.string()) },
    ]),
  ]);

  it('rejects a missing required key instead of encoding "undefined" / false', () => {
    expectInvalid(() => spec.encodeArgs('transfer', { flag: true }), 'args.memo', 'Missing');
    expectInvalid(() => spec.encodeArgs('transfer', { memo: 'hi' }), 'args.flag', 'Missing');
  });

  it('rejects a misspelled key and names the unknown and the expected keys', () => {
    expectInvalid(
      () => spec.encodeArgs('transfer', { memo: 'hi', flag: true, memmo: 'typo' }),
      "'memmo'",
      'memo, flag, note',
    );
  });

  it('treats Option<T> arguments as optional', () => {
    const [memo, flag, note] = spec.encodeArgs('transfer', { memo: 'hi', flag: true });

    expect(memo.switch().name).toBe('scvString');
    expect(flag.switch().name).toBe('scvBool');
    expect(note.switch().name).toBe('scvVoid');
  });

  it('encodes a provided Option value and treats null as none', () => {
    const some = spec.encodeArgs('transfer', { memo: 'hi', flag: false, note: 'n' });
    const none = spec.encodeArgs('transfer', { memo: 'hi', flag: false, note: null });

    expect(some[2].switch().name).toBe('scvString');
    expect(none[2].switch().name).toBe('scvVoid');
  });

  it('rejects an undefined positional argument for a required parameter', () => {
    expectInvalid(() => spec.encodeArgs('transfer', [undefined, true]), 'expects 3 arguments, got 2');
    expectInvalid(() => spec.encodeArgs('transfer', [undefined, true, null]), 'args.memo');
  });

  it('keeps the existing unknown-method and arity errors', () => {
    expectInvalid(() => spec.encodeArgs('nope', []), "Method 'nope' not found");
    expectInvalid(() => spec.encodeArgs('transfer', ['a']), 'expects 3 arguments, got 1');
    expectInvalid(() => spec.encodeArgs('transfer', 'a' as never), 'expected array or object');
  });
});

describe('SorobanSpec primitive validation (#265)', () => {
  const single = (type: xdr.ScSpecTypeDef) =>
    new SorobanSpec([fnEntry('f', [{ name: 'a', type }])]);

  describe('bool', () => {
    const spec = single(t.bool());

    it('accepts real booleans only', () => {
      expect(spec.encodeArgs('f', [true])[0].b()).toBe(true);
      expect(spec.encodeArgs('f', [false])[0].b()).toBe(false);
    });

    it.each([['false'], ['0'], [1], [0], [null], [{}]])('rejects %p', (bad) => {
      expectInvalid(() => spec.encodeArgs('f', [bad]), 'args.a', 'boolean');
    });
  });

  describe('u32 / i32', () => {
    const u32 = single(t.u32());
    const i32 = single(t.i32());

    it('accepts in-range integers as number, bigint and numeric string', () => {
      expect(u32.encodeArgs('f', [0])[0].u32()).toBe(0);
      expect(u32.encodeArgs('f', [4294967295])[0].u32()).toBe(4294967295);
      expect(u32.encodeArgs('f', [7n])[0].u32()).toBe(7);
      expect(u32.encodeArgs('f', ['12'])[0].u32()).toBe(12);
      expect(i32.encodeArgs('f', [-2147483648])[0].i32()).toBe(-2147483648);
      expect(i32.encodeArgs('f', [2147483647])[0].i32()).toBe(2147483647);
    });

    it.each([
      ['abc'],
      [''],
      [-1],
      [2 ** 40],
      [4294967296],
      [1.5],
      [NaN],
      [Infinity],
      [true],
      [null],
      [{}],
    ])('rejects %p for u32 at encodeArgs, not at XDR serialisation', (bad) => {
      expectInvalid(() => u32.encodeArgs('f', [bad]), 'args.a');
    });

    it.each([[2147483648], [-2147483649], ['1.5']])('rejects %p for i32', (bad) => {
      expectInvalid(() => i32.encodeArgs('f', [bad]), 'args.a', 'i32');
    });
  });

  describe('64/128/256-bit integers', () => {
    it('wraps raw BigInt RangeError/SyntaxError in a TrustFlowError with the parameter name', () => {
      const u64 = single(t.u64());

      expectInvalid(() => u64.encodeArgs('f', [1.5]), 'args.a', 'u64');
      expectInvalid(() => u64.encodeArgs('f', ['not a number']), 'args.a', 'u64');
      expectInvalid(() => u64.encodeArgs('f', [Number.MAX_SAFE_INTEGER + 2]), 'MAX_SAFE_INTEGER');
    });

    it('checks the range of each integer width', () => {
      expectInvalid(() => single(t.u64()).encodeArgs('f', [-1n]), 'u64 range');
      expectInvalid(() => single(t.u64()).encodeArgs('f', [2n ** 64n]), 'u64 range');
      expectInvalid(() => single(t.i64()).encodeArgs('f', [2n ** 63n]), 'i64 range');
      expectInvalid(() => single(t.u128()).encodeArgs('f', [2n ** 128n]), 'u128 range');
      expectInvalid(() => single(t.u128()).encodeArgs('f', [-1n]), 'u128 range');
      expectInvalid(() => single(t.i128()).encodeArgs('f', [2n ** 127n]), 'i128 range');
      expectInvalid(() => single(t.timepoint()).encodeArgs('f', [-1]), 'timepoint range');
      expectInvalid(() => single(t.duration()).encodeArgs('f', [2n ** 64n]), 'duration range');
    });

    it('accepts the boundary values', () => {
      expect(single(t.u64()).encodeArgs('f', [2n ** 64n - 1n])[0].switch().name).toBe('scvU64');
      expect(single(t.i64()).encodeArgs('f', [-(2n ** 63n)])[0].switch().name).toBe('scvI64');
      expect(single(t.i128()).encodeArgs('f', [2n ** 127n - 1n])[0].switch().name).toBe('scvI128');
      expect(single(t.i128()).encodeArgs('f', ['-5'])[0].switch().name).toBe('scvI128');
    });
  });

  describe('string and symbol', () => {
    it('requires a real string rather than coercing', () => {
      const spec = single(t.string());

      expect(spec.encodeArgs('f', ['hello'])[0].str().toString()).toBe('hello');
      expect(spec.encodeArgs('f', [''])[0].switch().name).toBe('scvString');
      expectInvalid(() => spec.encodeArgs('f', [42]), 'args.a', 'string');
      expectInvalid(() => spec.encodeArgs('f', [{}]), 'args.a', 'string');
    });

    it('accepts valid symbols and rejects empty, over-long or invalid-character ones', () => {
      const spec = single(t.symbol());

      expect(spec.encodeArgs('f', ['transfer_1'])[0].switch().name).toBe('scvSymbol');
      expectInvalid(() => spec.encodeArgs('f', ['']), 'args.a', 'symbol');
      expectInvalid(() => spec.encodeArgs('f', ['a'.repeat(33)]), 'args.a', 'symbol');
      expectInvalid(() => spec.encodeArgs('f', ['has space']), 'args.a', 'symbol');
      expectInvalid(() => spec.encodeArgs('f', [5]), 'args.a', 'symbol');
    });
  });

  describe('address', () => {
    const spec = single(t.address());

    it('encodes a valid address', () => {
      expect(spec.encodeArgs('f', [VALID_ADDRESS])[0].switch().name).toBe('scvAddress');
    });

    it.each([['not-an-address'], [''], [42], [null]])('rejects %p', (bad) => {
      expectInvalid(() => spec.encodeArgs('f', [bad]), 'args.a');
    });

    it('wraps the raw stellar-sdk error and keeps it as the cause', () => {
      const err = catchError(() => spec.encodeArgs('f', ['GBADADDRESS'])) as TrustFlowError;

      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.cause).toBeDefined();
    });
  });

  describe('bytes and BytesN', () => {
    // `ScVal.bytes()` returns a `Uint8Array`, whose `toString()` ignores an
    // encoding argument — wrap in `Buffer` to get the hex form.
    const hex = (scVal: xdr.ScVal): string => Buffer.from(scVal.bytes() as Uint8Array).toString('hex');

    it('accepts hex strings, Buffers and Uint8Arrays for Bytes', () => {
      const spec = single(t.bytes());

      expect(hex(spec.encodeArgs('f', ['00ff'])[0])).toBe('00ff');
      expect(hex(spec.encodeArgs('f', ['AB'])[0])).toBe('ab');
      expect(spec.encodeArgs('f', [''])[0].bytes().length).toBe(0);
      expect(spec.encodeArgs('f', [Buffer.from([1, 2, 3])])[0].bytes().length).toBe(3);
      expect(spec.encodeArgs('f', [new Uint8Array([9])])[0].bytes().length).toBe(1);
    });

    it.each([['zz'], ['abc'], ['0x00ff'], [42], [[1, 2]], [null]])(
      'rejects %p for Bytes instead of producing an empty or truncated buffer',
      (bad) => {
        expectInvalid(() => single(t.bytes()).encodeArgs('f', [bad]), 'args.a');
      },
    );

    it('enforces the fixed length of BytesN', () => {
      const spec = single(t.bytesN(4));

      expect(spec.encodeArgs('f', ['01020304'])[0].bytes().length).toBe(4);
      expect(spec.encodeArgs('f', [Buffer.alloc(4)])[0].bytes().length).toBe(4);
      expectInvalid(() => spec.encodeArgs('f', ['010203']), 'args.a', 'exactly 4 bytes, got 3');
      expectInvalid(() => spec.encodeArgs('f', ['0102030405']), 'exactly 4 bytes, got 5');
      expectInvalid(() => spec.encodeArgs('f', [Buffer.alloc(2)]), 'exactly 4 bytes, got 2');
    });
  });
});

describe('SorobanSpec container validation and error paths (#265)', () => {
  it('rejects a tuple whose arity differs from the spec', () => {
    const spec = new SorobanSpec([
      fnEntry('f', [{ name: 'pair', type: t.tuple([t.u32(), t.string()]) }]),
    ]);

    expect(spec.encodeArgs('f', [[1, 'a']])[0].switch().name).toBe('scvVec');
    expectInvalid(() => spec.encodeArgs('f', [[1]]), 'args.pair', '2 element(s), got 1');
    expectInvalid(() => spec.encodeArgs('f', [[1, 'a', 'extra']]), 'args.pair', 'got 3');
    expectInvalid(() => spec.encodeArgs('f', ['nope']), 'args.pair', 'array');
  });

  it('includes the index of the failing element for vectors', () => {
    const spec = new SorobanSpec([fnEntry('f', [{ name: 'metadata', type: t.vec(t.u32()) }])]);

    expect(spec.encodeArgs('f', [[1, 2, 3]])[0].switch().name).toBe('scvVec');
    expectInvalid(() => spec.encodeArgs('f', [[1, 2, 'bad']]), 'args.metadata[2]');
    expectInvalid(() => spec.encodeArgs('f', [{}]), 'args.metadata', 'array');
  });

  it('includes the parameter path for nested containers', () => {
    const spec = new SorobanSpec([
      fnEntry('f', [{ name: 'rows', type: t.vec(t.tuple([t.u32(), t.bytesN(2)])) }]),
    ]);

    expectInvalid(() => spec.encodeArgs('f', [[[1, '0102'], [2, '01']]]), 'args.rows[1][1]');
    expectInvalid(() => spec.encodeArgs('f', [[[1, '0102'], [-2, '0102']]]), 'args.rows[1][0]');
  });

  it('validates map keys and values and rejects non-map input', () => {
    const spec = new SorobanSpec([
      fnEntry('f', [{ name: 'balances', type: t.map(t.symbol(), t.u32()) }]),
    ]);

    expect(spec.encodeArgs('f', [{ alice: 1, bob: 2 }])[0].switch().name).toBe('scvMap');
    expect(spec.encodeArgs('f', [new Map([['alice', 1]])])[0].switch().name).toBe('scvMap');
    expectInvalid(() => spec.encodeArgs('f', [{ alice: 'x' }]), 'args.balances[alice]');
    expectInvalid(() => spec.encodeArgs('f', [{ 'bad key': 1 }]), 'args.balances', 'key');
    expectInvalid(() => spec.encodeArgs('f', ['nope']), 'args.balances', 'Map or an object');
    expectInvalid(() => spec.encodeArgs('f', [[1, 2]]), 'args.balances', 'Map or an object');
  });

  describe('structs', () => {
    const spec = new SorobanSpec([
      structEntry('Terms', [
        { name: 'amount', type: t.u128() },
        { name: 'memo', type: t.option(t.string()) },
      ]),
      fnEntry('f', [{ name: 'terms', type: t.udt('Terms') }]),
    ]);

    it('encodes a struct with all fields and with an omitted Option field', () => {
      expect(spec.encodeArgs('f', [{ amount: 5n, memo: 'x' }])[0].switch().name).toBe('scvMap');
      expect(spec.encodeArgs('f', [{ amount: 5n }])[0].switch().name).toBe('scvMap');
    });

    it('rejects a missing required field, a misspelled field and a non-object', () => {
      expectInvalid(() => spec.encodeArgs('f', [{ memo: 'x' }]), 'args.terms.amount', 'Missing');
      expectInvalid(
        () => spec.encodeArgs('f', [{ amount: 5n, memoo: 'x' }]),
        'args.terms',
        "'memoo'",
        'amount, memo',
      );
      expectInvalid(() => spec.encodeArgs('f', ['nope']), 'args.terms', 'struct Terms');
      expectInvalid(() => spec.encodeArgs('f', [null]), 'args.terms', 'struct Terms');
    });

    it('reports the path of an invalid struct field', () => {
      expectInvalid(() => spec.encodeArgs('f', [{ amount: -1n }]), 'args.terms.amount', 'u128');
    });
  });

  it('never lets a raw RangeError, SyntaxError or TypeError escape for bad input', () => {
    const spec = new SorobanSpec([
      fnEntry('f', [
        { name: 'a', type: t.u64() },
        { name: 'b', type: t.address() },
        { name: 'c', type: t.bytesN(4) },
        { name: 'd', type: t.u32() },
      ]),
    ]);
    const bad: unknown[][] = [
      [1.5, VALID_ADDRESS, '01020304', 1],
      ['x', VALID_ADDRESS, '01020304', 1],
      [1, 'bad', '01020304', 1],
      [1, VALID_ADDRESS, 'zz', 1],
      [1, VALID_ADDRESS, '01020304', 2 ** 40],
      [1, VALID_ADDRESS, '01020304', 'abc'],
    ];

    for (const args of bad) {
      const err = catchError(() => spec.encodeArgs('f', args));
      expect(err).toBeInstanceOf(TrustFlowError);
    }
  });

  it('valToScVal defaults the error path to "value" and accepts a custom path', () => {
    const spec = new SorobanSpec([]);

    expectInvalid(() => spec.valToScVal('abc', t.u32()), 'Invalid value');
    expectInvalid(() => spec.valToScVal('abc', t.u32(), 'custom.path'), 'custom.path');
  });
});

/**
 * The Soroban runtime requires an `scvMap`'s entries to be in strictly increasing
 * key order. Both hand-built map shapes in `valToScVal` — user-defined structs
 * and `scSpecTypeMap` — used to emit entries in declaration / insertion order, so
 * any struct whose fields are not declared alphabetically and any map passed with
 * unsorted keys produced an argument the host rejects.
 */
describe('SorobanSpec map key ordering', () => {
  /** Symbol keys of an encoded `scvMap`, in the order they were emitted. */
  const symbolKeys = (scVal: xdr.ScVal): string[] =>
    (scVal.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()) as string);

  const mapSpec = (keyType: xdr.ScSpecTypeDef, valueType = t.u32()) =>
    new SorobanSpec([fnEntry('f', [{ name: 'm', type: t.map(keyType, valueType) }])]);

  describe('user-defined structs', () => {
    const spec = new SorobanSpec([
      // Declared in deliberately non-alphabetical order.
      structEntry('Terms', [
        { name: 'zeta', type: t.u32() },
        { name: 'alpha', type: t.u32() },
        { name: 'mid', type: t.u32() },
      ]),
      fnEntry('f', [{ name: 'terms', type: t.udt('Terms') }]),
    ]);

    it('emits fields in sorted key order, not declaration order', () => {
      const [encoded] = spec.encodeArgs('f', [{ zeta: 1, alpha: 2, mid: 3 }]);

      expect(encoded.switch().name).toBe('scvMap');
      expect(symbolKeys(encoded)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('keeps each value paired with its own field', () => {
      const [encoded] = spec.encodeArgs('f', [{ zeta: 1, alpha: 2, mid: 3 }]);

      const pairs = (encoded.map() as xdr.ScMapEntry[]).map((e) => [
        scValToNative(e.key()),
        scValToNative(e.val()),
      ]);

      expect(pairs).toEqual([
        ['alpha', 2],
        ['mid', 3],
        ['zeta', 1],
      ]);
    });

    it('sorts case-sensitively and bytewise, where a locale comparison would not', () => {
      const mixedCase = new SorobanSpec([
        structEntry('Mixed', [
          { name: 'alpha', type: t.u32() },
          { name: 'Alpha', type: t.u32() },
          { name: 'Zeta', type: t.u32() },
          { name: '_x', type: t.u32() },
          { name: 'a10', type: t.u32() },
          { name: 'a2', type: t.u32() },
        ]),
        fnEntry('f', [{ name: 'm', type: t.udt('Mixed') }]),
      ]);

      const [encoded] = mixedCase.encodeArgs('f', [
        { alpha: 1, Alpha: 2, Zeta: 3, _x: 4, a10: 5, a2: 6 },
      ]);

      // Bytewise (host) order. `localeCompare`, which `xdr.scvSortedMap` uses,
      // yields ['_x', 'a10', 'a2', 'alpha', 'Alpha', 'Zeta'] instead.
      expect(symbolKeys(encoded)).toEqual(['Alpha', 'Zeta', '_x', 'a10', 'a2', 'alpha']);
    });

    it('round-trips the sorted struct through scValToNative', () => {
      const [encoded] = spec.encodeArgs('f', [{ zeta: 1, alpha: 2, mid: 3 }]);

      expect(spec.decodeReturnValue('f', encoded)).toEqual({ zeta: 1, alpha: 2, mid: 3 });
    });
  });

  describe('scSpecTypeMap', () => {
    it('sorts an object supplied with unsorted keys', () => {
      const spec = mapSpec(t.symbol());
      const [encoded] = spec.encodeArgs('f', [{ bob: 2, alice: 1, carol: 3 }]);

      expect(symbolKeys(encoded)).toEqual(['alice', 'bob', 'carol']);
    });

    it('sorts a Map supplied in insertion order', () => {
      const spec = mapSpec(t.symbol());
      const [encoded] = spec.encodeArgs('f', [new Map([['zed', 1], ['ay', 2], ['mid', 3]])]);

      expect(symbolKeys(encoded)).toEqual(['ay', 'mid', 'zed']);
    });

    it('produces the same encoding whatever the input order', () => {
      const spec = mapSpec(t.symbol());
      const a = spec.encodeArgs('f', [{ a: 1, b: 2, c: 3 }])[0];
      const b = spec.encodeArgs('f', [{ c: 3, b: 2, a: 1 }])[0];
      const c = spec.encodeArgs('f', [new Map([['b', 2], ['c', 3], ['a', 1]])])[0];

      expect(a.toXDR('base64')).toBe(b.toXDR('base64'));
      expect(a.toXDR('base64')).toBe(c.toXDR('base64'));
    });

    it('sorts string keys bytewise', () => {
      const spec = mapSpec(t.string());
      const [encoded] = spec.encodeArgs('f', [{ Zeta: 1, alpha: 2, Alpha: 3 }]);

      const keys = (encoded.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()));
      expect(keys).toEqual(['Alpha', 'Zeta', 'alpha']);
    });

    it('sorts u32 keys numerically, not lexicographically', () => {
      const spec = mapSpec(t.u32());
      const [encoded] = spec.encodeArgs('f', [new Map([[100, 1], [2, 2], [10, 3]])]);

      const keys = (encoded.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()));
      expect(keys).toEqual([2, 10, 100]);
    });

    it('sorts i32 keys numerically with negatives first', () => {
      const spec = mapSpec(t.i32());
      const [encoded] = spec.encodeArgs('f', [new Map([[5, 1], [-1, 2], [-9, 3]])]);

      const keys = (encoded.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()));
      expect(keys).toEqual([-9, -1, 5]);
    });

    it('sorts u64 and i128 keys numerically across the whole range', () => {
      const u64 = mapSpec(t.u64());
      const [u64Val] = u64.encodeArgs('f', [
        new Map([
          [2n ** 64n - 1n, 1],
          [0n, 2],
          [1n, 3],
        ]),
      ]);
      expect((u64Val.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()))).toEqual([
        0n,
        1n,
        2n ** 64n - 1n,
      ]);

      const i128 = mapSpec(t.i128());
      const [i128Val] = i128.encodeArgs('f', [
        new Map([
          [0n, 1],
          [-1n, 2],
          [-(2n ** 127n), 3],
        ]),
      ]);
      expect((i128Val.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()))).toEqual([
        -(2n ** 127n),
        -1n,
        0n,
      ]);
    });

    it('sorts address keys by the host order, not by base58 string order', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const spec = mapSpec(t.address());
      const [encoded] = spec.encodeArgs('f', [new Map([[VALID_ADDRESS, 1], [contractId, 2]])]);

      const keys = (encoded.map() as xdr.ScMapEntry[]).map((e) => String(scValToNative(e.key())));
      // `scvSortedMap` would order these by base58 (`C...` < `G...`), but the
      // host orders an `ScAddress` by its XDR union discriminant first, and an
      // account address (0) sorts before a contract address (1).
      expect(keys).toEqual([VALID_ADDRESS, contractId]);
    });

    it('round-trips the sorted map through scValToNative', () => {
      const spec = mapSpec(t.symbol());
      const [encoded] = spec.encodeArgs('f', [{ bob: 2, alice: 1, carol: 3 }]);

      expect(spec.decodeReturnValue('f', encoded)).toEqual({ bob: 2, alice: 1, carol: 3 });
    });

    it('sorts a nested map and a map inside a vec', () => {
      const spec = new SorobanSpec([
        fnEntry('f', [
          { name: 'rows', type: t.vec(t.map(t.symbol(), t.u32())) },
          { name: 'outer', type: t.map(t.string(), t.map(t.string(), t.string())) },
        ]),
      ]);

      const [rows, outer] = spec.encodeArgs('f', [
        [{ b: 1, a: 2 }],
        { y: { d: '4', c: '3' }, x: { b: '2', a: '1' } },
      ]);

      expect(symbolKeys(rows.vec()![0])).toEqual(['a', 'b']);
      const outerKeys = (outer.map() as xdr.ScMapEntry[]).map((e) => scValToNative(e.key()));
      expect(outerKeys).toEqual(['x', 'y']);
      expect(symbolKeys((outer.map() as xdr.ScMapEntry[])[1].val())).toEqual(['c', 'd']);
    });
  });

  describe('duplicate keys', () => {
    // A JS `Map` collapses equal keys, and a plain object never had two, so the
    // only way a caller can smuggle a duplicate past the encoder is by passing
    // keys that are distinct natively but encode to the same `ScVal` — which
    // `parseInteger` accepts as a number, a bigint or a numeric string.
    it('rejects a number key and its bigint spelling', () => {
      const spec = mapSpec(t.u32(), t.string());

      expectInvalid(
        () => spec.encodeArgs('f', [new Map([[1, 'a'], [1n, 'b']])]),
        'args.m',
        "duplicate map key '1'",
      );
    });

    it('rejects a number key and its numeric-string spelling', () => {
      const spec = mapSpec(t.u32(), t.string());

      expectInvalid(
        () => spec.encodeArgs('f', [new Map([[1, 'a'], ['1', 'b']])]),
        "duplicate map key '1'",
      );
    });

    it('rejects duplicates that only become adjacent after sorting', () => {
      const spec = mapSpec(t.u32(), t.string());

      expectInvalid(
        () => spec.encodeArgs('f', [new Map([[9, 'x'], [1, 'a'], [1n, 'b']])]),
        "duplicate map key '1'",
      );
    });

    it('rejects a struct spec that declares the same field twice', () => {
      const spec = new SorobanSpec([
        structEntry('Dup', [
          { name: 'amount', type: t.u32() },
          { name: 'amount', type: t.u32() },
        ]),
        fnEntry('f', [{ name: 'd', type: t.udt('Dup') }]),
      ]);

      expectInvalid(() => spec.encodeArgs('f', [{ amount: 1 }]), 'args.d', 'duplicate map key');
    });

    it('accepts a single-entry map and an empty one', () => {
      const spec = mapSpec(t.symbol());

      expect(symbolKeys(spec.encodeArgs('f', [{}])[0])).toEqual([]);
      expect(symbolKeys(spec.encodeArgs('f', [{ only: 1 }])[0])).toEqual(['only']);
    });
  });
});
