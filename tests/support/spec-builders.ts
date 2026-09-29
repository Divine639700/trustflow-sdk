import { xdr } from '@stellar/stellar-sdk';

export interface SpecInput {
  name: string;
  type: xdr.ScSpecTypeDef;
}

export interface StructField extends SpecInput {}

export interface UnionCase {
  name: string;
  types?: xdr.ScSpecTypeDef[];
}

export function functionEntry(
  name: string,
  inputs: SpecInput[] = [],
  outputs: xdr.ScSpecTypeDef[] = [],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: '',
      name,
      inputs: inputs.map(
        (input) =>
          new xdr.ScSpecFunctionInputV0({
            doc: '',
            name: input.name,
            type: input.type,
          }),
      ),
      outputs,
    }),
  );
}

export function structEntry(name: string, fields: StructField[]): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: fields.map(
        (field) =>
          new xdr.ScSpecUdtStructFieldV0({
            doc: '',
            name: field.name,
            type: field.type,
          }),
      ),
    }),
  );
}

export function enumEntry(
  name: string,
  cases: Array<{ name: string; value: number }>,
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtEnumV0(
    new xdr.ScSpecUdtEnumV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map(
        (item) =>
          new xdr.ScSpecUdtEnumCaseV0({
            doc: '',
            name: item.name,
            value: item.value,
          }),
      ),
    }),
  );
}

export function unionEntry(name: string, cases: UnionCase[]): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
    new xdr.ScSpecUdtUnionV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map((item) =>
        item.types
          ? xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
              new xdr.ScSpecUdtUnionCaseTupleV0({
                doc: '',
                name: item.name,
                type: item.types,
              }),
            )
          : xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
              new xdr.ScSpecUdtUnionCaseVoidV0({ doc: '', name: item.name }),
            ),
      ),
    }),
  );
}

export function optionType(valueType: xdr.ScSpecTypeDef): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({ valueType }));
}

export function resultType(
  okType: xdr.ScSpecTypeDef,
  errorType: xdr.ScSpecTypeDef,
): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeResult(new xdr.ScSpecTypeResult({ okType, errorType }));
}

export function vecType(elementType: xdr.ScSpecTypeDef): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({ elementType }));
}

export function mapType(
  keyType: xdr.ScSpecTypeDef,
  valueType: xdr.ScSpecTypeDef,
): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeMap(new xdr.ScSpecTypeMap({ keyType, valueType }));
}

export function tupleType(valueTypes: xdr.ScSpecTypeDef[]): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeTuple(new xdr.ScSpecTypeTuple({ valueTypes }));
}

export function bytesNType(n: number): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n }));
}

export function udtType(name: string): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}
