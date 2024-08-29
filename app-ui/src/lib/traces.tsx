export function traceDelete(id: string): Promise<Response> {
    return fetch(`/api/v1/trace/${id}`, {
        method: 'DELETE'
    })
}
