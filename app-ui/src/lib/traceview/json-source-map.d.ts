declare module 'json-source-map' {
    export function parse(json: string): { data: any, pointers: any };
    export function stringify(data: any, pointers: any): string;
}