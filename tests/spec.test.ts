import { Address, Keypair, scValToNative, xdr } from '@stellar/stellar-sdk';
import { SorobanSpec } from '../src/contract/spec';
import {
  bytesNType,
  enumEntry,
  functionEntry,
  mapType,
  optionType,
  resultType,
  structEntry,
  tupleType,
  udtType,
  unionEntry,
  vecType,
} from './support/spec-builders';

describe('SorobanSpec', () => {
  const scalarCases: Array<{
    name: string;
    type: xdr.ScSpecTypeDef;
    value: unknown;
    switchName: string;
    expected: unknown;
  }> = [
    { name: 'bool', type: xdr.ScSpecTypeDef.scSpecTypeBool(), value: true, switchName: 'scvBool', expected: true },
    { name: 'void', type: xdr.ScSpecTypeDef.scSpecTypeVoid(), value: null, switchName: 'scvVoid', expected: null },
    { name: 'u32', type: xdr.ScSpecTypeDef.scSpecTypeU32(), value: 42, switchName: 'scvU32', expected: 42 },
    { name: 'i32', type: xdr.ScSpecTypeDef.scSpecTypeI32(), value: -42, switchName: 'scvI32', expected: -42 },
    { name: 'u64', type: xdr.ScSpecTypeDef.scSpecTypeU64(), value: 42n, switchName: 'scvU64', expected: 42n },
    { name: 'i64', type: xdr.ScSpecTypeDef.scSpecTypeI64(), value: -42n, switchName: 'scvI64', expected: -42n },
    { name: 'timepoint', type: xdr.ScSpecTypeDef.scSpecTypeTimepoint(), value: 42n, switchName: 'scvTimepoint', expected: 42n },
    { name: 'duration', type: xdr.ScSpecTypeDef.scSpecTypeDuration(), value: 42n, switchName: 'scvDuration', expected: 42n },
    { name: 'u128', type: xdr.ScSpecTypeDef.scSpecTypeU128(), value: 42n, switchName: 'scvU128', expected: 42n },
    { name: 'i128', type: xdr.ScSpecTypeDef.scSpecTypeI128(), value: -42n, switchName: 'scvI128', expected: -42n },
    { name: 'u256', type: xdr.ScSpecTypeDef.scSpecTypeU256(), value: 42n, switchName: 'scvU256', expected: 42n },
    { name: 'i256', type: xdr.ScSpecTypeDef.scSpecTypeI256(), value: -42n, switchName: 'scvI256', expected: -42n },
    { name: 'bytes', type: xdr.ScSpecTypeDef.scSpecTypeBytes(), value: Buffer.from([1, 2]), switchName: 'scvBytes', expected: Buffer.from([1, 2]) },
    { name: 'string', type: xdr.ScSpecTypeDef.scSpecTypeString(), value: 'text', switchName: 'scvString', expected: 'text' },
    { name: 'symbol', type: xdr.ScSpecTypeDef.scSpecTypeSymbol(), value: 'symbol', switchName: 'scvSymbol', expected: 'symbol' },
  ];

  it.each(scalarCases)('encodes and decodes $name by its declared type', ({ type, value, switchName, expected }) => {
    const spec = new SorobanSpec(functionEntry('echo', [{ name: 'value', type }], [type]));
    const encoded = spec.encodeArgs('echo', [value])[0];
    expect(encoded.switch().name).toBe(switchName);
    expect(scValToNative(encoded)).toEqual(expected);
    expect(spec.decodeReturnValue('echo', encoded)).toEqual(expected);
  });

  it('encodes addresses, fixed bytes, options, vectors, maps, and tuples', () => {
    const address = Keypair.random().publicKey();
    const cases = [
      {
        type: xdr.ScSpecTypeDef.scSpecTypeAddress(),
        value: address,
        switchName: 'scvAddress',
      },
      { type: bytesNType(2), value: Buffer.from([1, 2]), switchName: 'scvBytes' },
      { type: optionType(xdr.ScSpecTypeDef.scSpecTypeU32()), value: null, switchName: 'scvVoid' },
      {
        type: optionType(xdr.ScSpecTypeDef.scSpecTypeU32()),
        value: 4,
        switchName: 'scvU32',
      },
      {
        type: vecType(xdr.ScSpecTypeDef.scSpecTypeU32()),
        value: [],
        switchName: 'scvVec',
      },
      {
        type: mapType(xdr.ScSpecTypeDef.scSpecTypeSymbol(), xdr.ScSpecTypeDef.scSpecTypeU32()),
        value: new Map([['a', 1]]),
        switchName: 'scvMap',
      },
      {
        type: tupleType([xdr.ScSpecTypeDef.scSpecTypeU32(), xdr.ScSpecTypeDef.scSpecTypeString()]),
        value: [7, 'seven'],
        switchName: 'scvVec',
      },
    ];
    for (const { type, value, switchName } of cases) {
      const spec = new SorobanSpec(functionEntry('echo', [{ name: 'value', type }], [type]));
      const encoded = spec.encodeArgs('echo', [value])[0];
      expect(encoded.switch().name).toBe(switchName);
      expect(spec.decodeReturnValue('echo', encoded)).toBeDefined();
    }
    expect(new SorobanSpec(functionEntry('echo', [{ name: 'a', type: optionType(xdr.ScSpecTypeDef.scSpecTypeU32()) }]))
      .encodeArgs('echo', { a: undefined })[0].switch().name).toBe('scvVoid');
    expect(() =>
      new SorobanSpec(functionEntry('echo', [{ name: 'a', type: bytesNType(2) }])).encodeArgs(
        'echo',
        [Buffer.from([1])],
      ),
    ).toThrow();
    expect(address).toMatch(/^G/);
  });

  it('accepts positional and named arguments and rejects invalid shapes', () => {
    const input = functionEntry('add', [
      { name: 'left', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
      { name: 'right', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
    ]);
    const spec = new SorobanSpec(input);

    expect(spec.encodeArgs('add', [2, 3]).map((value) => value.u32())).toEqual([2, 3]);
    expect(spec.encodeArgs('add', { right: 3, left: 2 }).map((value) => value.u32())).toEqual([2, 3]);
    expect(() => spec.encodeArgs('add', [2])).toThrow('expects 2 arguments');
    expect(() => spec.encodeArgs('add', { left: 2 })).toThrow('Missing argument');
    expect(() => spec.encodeArgs('add', { left: 2, right: 3, extra: 4 })).toThrow('Unknown argument');
    expect(() => spec.encodeArgs('missing', [])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
  });

  it('parses real spec entries from XDR objects, base64, hex, Uint8Array, and Buffer', () => {
    const entry = functionEntry('echo', [{ name: 'value', type: xdr.ScSpecTypeDef.scSpecTypeU32() }]);
    const base64 = entry.toXDR('base64');
    const hex = entry.toXDR('hex');

    const specs = [
      new SorobanSpec(entry),
      new SorobanSpec(base64),
      new SorobanSpec(hex),
      new SorobanSpec(new Uint8Array(entry.toXDR())),
      new SorobanSpec(Buffer.from(entry.toXDR())),
    ];
    for (const spec of specs) {
      expect(spec.getFunction('echo').name().toString()).toBe('echo');
      expect(spec.encodeArgs('echo', [9])[0].u32()).toBe(9);
    }
  });

  it('encodes enums as u32 discriminants and rejects invalid cases', () => {
    const status = enumEntry('Status', [
      { name: 'Open', value: 0 },
      { name: 'Closed', value: 3 },
    ]);
    const type = udtType('Status');
    const spec = new SorobanSpec([status, functionEntry('status', [{ name: 'value', type }], [type])]);

    const byName = spec.encodeArgs('status', ['Closed'])[0];
    expect(byName.switch().name).toBe('scvU32');
    expect(byName.u32()).toBe(3);
    expect(spec.decodeReturnValue('status', byName)).toBe(3);
    expect(() => spec.encodeArgs('status', ['Unknown'])).toThrow('Unknown enum');
    expect(() => spec.encodeArgs('status', [1])).toThrow('Unknown enum');
  });

  it('regression #263: constructs real union specs and round-trips unit and payload cases', () => {
    const paymentType = udtType('Payment');
    const spec = new SorobanSpec([
      unionEntry('Payment', [
        { name: 'Nop' },
        { name: 'Pay', types: [xdr.ScSpecTypeDef.scSpecTypeU128(), optionType(vecType(xdr.ScSpecTypeDef.scSpecTypeU32()))] },
      ]),
      functionEntry('payment', [{ name: 'value', type: paymentType }], [paymentType]),
    ]);

    for (const input of [{ tag: 'Nop' }, { tag: 'Pay', values: [5n, [1, 2]] }]) {
      const encoded = spec.encodeArgs('payment', [input])[0];
      expect(encoded.switch().name).toBe('scvVec');
      expect(spec.decodeReturnValue('payment', encoded)).toEqual(input);
    }
    expect(() => spec.encodeArgs('payment', [{ tag: 'Missing' }])).toThrow('Unknown union case');
    expect(() => spec.encodeArgs('payment', [{ tag: 'Pay', values: [5n] }])).toThrow('expects 2 values');
  });

  it('regression #265: encodes named struct fields in sorted key order and decodes by name', () => {
    const type = udtType('Record');
    const spec = new SorobanSpec([
      structEntry('Record', [
        { name: 'zeta', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
        { name: 'alpha', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
      ]),
      functionEntry('record', [{ name: 'value', type }], [type]),
    ]);
    const encoded = spec.encodeArgs('record', [{ zeta: 2, alpha: 1 }])[0];

    expect(encoded.switch().name).toBe('scvMap');
    expect(encoded.map()?.map((entry) => entry.key().sym().toString())).toEqual(['alpha', 'zeta']);
    expect(spec.decodeReturnValue('record', encoded)).toEqual({ zeta: 2, alpha: 1 });
    expect(() => spec.encodeArgs('record', [{ alpha: 1 }])).toThrow('Missing struct field');
  });

  it('round-trips tuple structs, maps, and Result values', () => {
    const tupleStruct = udtType('TupleRecord');
    const errorType = udtType('CallError');
    const result = resultType(
      xdr.ScSpecTypeDef.scSpecTypeU32(),
      errorType,
    );
    const spec = new SorobanSpec([
      structEntry('TupleRecord', [
        { name: '0', type: xdr.ScSpecTypeDef.scSpecTypeU32() },
        { name: '1', type: xdr.ScSpecTypeDef.scSpecTypeString() },
      ]),
      xdr.ScSpecEntry.scSpecEntryUdtErrorEnumV0(
        new xdr.ScSpecUdtErrorEnumV0({
          doc: '',
          lib: '',
          name: 'CallError',
          cases: [
            new xdr.ScSpecUdtErrorEnumCaseV0({ doc: '', name: 'Denied', value: 7 }),
          ],
        }),
      ),
      functionEntry('tuple', [{ name: 'value', type: tupleStruct }], [tupleStruct]),
      functionEntry('result', [{ name: 'value', type: result }], [result]),
      functionEntry('mapped', [
        {
          name: 'value',
          type: mapType(xdr.ScSpecTypeDef.scSpecTypeSymbol(), xdr.ScSpecTypeDef.scSpecTypeU32()),
        },
      ], [
        mapType(xdr.ScSpecTypeDef.scSpecTypeSymbol(), xdr.ScSpecTypeDef.scSpecTypeU32()),
      ]),
    ]);

    const tupleEncoded = spec.encodeArgs('tuple', [[8, 'eight']])[0];
    expect(spec.decodeReturnValue('tuple', tupleEncoded)).toEqual([8, 'eight']);
    const ok = spec.encodeArgs('result', [{ ok: 11 }])[0];
    expect(spec.decodeReturnValue('result', ok)).toEqual({ ok: 11 });
    const error = spec.encodeArgs('result', [{ error: 'Denied' }])[0];
    expect(error.switch().name).toBe('scvError');
    expect(spec.decodeReturnValue('result', error)).toEqual({ error: 'Denied' });
    const mapTypeDef = mapType(xdr.ScSpecTypeDef.scSpecTypeSymbol(), xdr.ScSpecTypeDef.scSpecTypeU32());
    const mapped = spec.valToScVal(new Map(), mapTypeDef);
    expect(mapped.map()).toEqual([]);
    const mapValue = new Map([['one', 1], ['two', 2]]);
    const mapEncoded = spec.encodeArgs('mapped', [mapValue])[0];
    expect(spec.decodeReturnValue('mapped', mapEncoded)).toEqual(mapValue);
  });

  it('regressions #264, #266, and #270: encodes wide integers and time values from real specs', () => {
    const types = [
      { name: 'u128', type: xdr.ScSpecTypeDef.scSpecTypeU128(), value: 1n << 100n, switchName: 'scvU128' },
      { name: 'timepoint', type: xdr.ScSpecTypeDef.scSpecTypeTimepoint(), value: 123n, switchName: 'scvTimepoint' },
      { name: 'duration', type: xdr.ScSpecTypeDef.scSpecTypeDuration(), value: 321n, switchName: 'scvDuration' },
    ];
    for (const { name, type, value, switchName } of types) {
      const spec = new SorobanSpec(functionEntry(name, [{ name: 'value', type }], [type]));
      const encoded = spec.encodeArgs(name, [value])[0];
      expect(encoded.switch().name).toBe(switchName);
      expect(spec.decodeReturnValue(name, encoded)).toBe(value);
    }
  });

  it('decodes return values from base64 XDR and reports malformed or unsupported types', () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeU32();
    const spec = new SorobanSpec(functionEntry('read', [], [type]));
    const payload = xdr.ScVal.scvU32(17).toXDR('base64');
    expect(spec.parseXDRPayload(payload).u32()).toBe(17);
    expect(spec.decodeReturnValue('read', payload)).toBe(17);
    expect(() => spec.parseXDRPayload('not-xdr')).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.valToScVal('no', xdr.ScSpecTypeDef.scSpecTypeMuxedAddress())).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.valToScVal(1, xdr.ScSpecTypeDef.scSpecTypeError())).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.valToScVal(1, xdr.ScSpecTypeDef.scSpecTypeVal())).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.decodeReturnValue('missing', xdr.ScVal.scvU32(1))).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
  });

  it('rejects invalid fixed bytes, tuple arity, and malformed return values', () => {
    const bytesType = bytesNType(2);
    const tuple = tupleType([xdr.ScSpecTypeDef.scSpecTypeU32()]);
    const spec = new SorobanSpec([
      functionEntry('bytes', [{ name: 'value', type: bytesType }], [bytesType]),
      functionEntry('tuple', [{ name: 'value', type: tuple }], [tuple]),
      functionEntry('empty', [], []),
    ]);

    expect(() => spec.encodeArgs('bytes', [Buffer.from([1])])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.encodeArgs('tuple', [[1, 2]])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(() => spec.decodeReturnValue('tuple', xdr.ScVal.scvVec([]))).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
    expect(spec.decodeReturnValue('empty', xdr.ScVal.scvVoid())).toBeNull();
    expect(() => spec.decodeReturnValue('empty', xdr.ScVal.scvU32(1))).toThrow(
      expect.objectContaining({ code: 'INVALID_CONTRACT_CALL' }),
    );
  });

  it('does not silently treat unknown symbols or non-address values as valid', () => {
    const type = xdr.ScSpecTypeDef.scSpecTypeAddress();
    const spec = new SorobanSpec(functionEntry('address', [], [type]));
    expect(() => spec.decodeReturnValue('address', xdr.ScVal.scvString('not an address'))).toThrow();
    expect(Address.fromString(Keypair.random().publicKey()).toString()).toMatch(/^G/);
  });
});
