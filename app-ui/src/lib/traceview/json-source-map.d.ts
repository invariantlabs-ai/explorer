// Simple TS definition file for json-source-map npmjs package, which does not provide its own types.
declare module "json-source-map" {
  export function parse(json: string): { data: any; pointers: any };
  export function stringify(data: any, pointers: any): string;
}
