/** Encapsulates a streaming fetch request for faster result display with cancellation support. */
import { useState, useEffect } from 'react'

export class StreamingFetch {
    /**
     * Combination of a POST request and a successive SSE-based streaming response.
     * 
     * Unifies result and error handling across both requests and is also exposed via useStreamingEndpoint.
     */
    constructor(endpoint, payload) {
        this.endpoint = endpoint
        this.payload = payload
        this.state = StreamingFetch.UNINITIALIZED
        this.eventSource = null

        this.onerrorListeners = []
        this.onresultListeners = []
        this.oncloseListeners = []
    }

    onerror(listener) {
        this.onerrorListeners.push(listener)
    }

    offerror(listener) {
        this.onerrorListeners = this.onerrorListeners.filter(l => l !== listener)
    }

    onresult(listener) {
        this.onresultListeners.push(listener)
    }

    offresult(listener) {
        this.onresultListeners = this.onresultListeners.filter(l => l !== listener)
    }

    onclose(listener) {
        this.oncloseListeners.push(listener)
    }

    offclose(listener) {
        this.oncloseListeners = this.oncloseListeners.filter(l => l !== listener)
    }

    close() {
        this.state = StreamingFetch.CLOSED
        if (this.eventSource) this.eventSource.close()

        this.oncloseListeners.forEach(listener => listener())

        // clear listeners
        this.oncloseListeners = []
        this.onerrorListeners = []
        this.onresultListeners = []
    }

    start() {
        if (this.state !== StreamingFetch.UNINITIALIZED) {
            throw new Error('StreamingFetch already started')
        }

        this.state = StreamingFetch.QUERYING

        // first post to /query to get result stream ID
        fetch(this.endpoint + '', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(this.payload)
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    this.onerrorListeners.forEach(listener => listener(data.error))
                    this.close()
                }

                // check if we are still in the querying state (otherwise the request was already cancelled)
                if (this.state !== StreamingFetch.QUERYING) {
                    return
                }

                this.state = StreamingFetch.STREAMING
                const eventSource = new EventSource(this.endpoint + '/' + data.id)
                eventSource.onmessage = (e) => {
                    let data = e.data;
                    if (e.data) {
                        data = JSON.parse(e.data)
                    }
                    if (data.event == "done") {
                        this.close()
                    } else if (data.event == "error") {
                        this.onerrorListeners.forEach(listener => listener(data.error || "unknown error"))
                    } else {
                        this.onresultListeners.forEach(listener => listener(data))
                    }
                }
                eventSource.onerror = (e) => {
                    this.state = StreamingFetch.CLOSED
                    this.onerrorListeners.forEach(listener => listener(e))
                    this.close()
                }
                eventSource.onclose = (e) => {
                    this.state = StreamingFetch.CLOSED
                    this.oncloseListeners.forEach(listener => listener(e))
                    this.close()
                }

                this.eventSource = eventSource
            })
            .catch((error) => {
                console.log("POST error", error)
                this.state = StreamingFetch.CLOSED
                this.onerrorListeners.forEach(listener => listener(error))
                this.oncloseListeners.forEach(listener => listener(error))
                this.close()
            });
    }

    cancel() {
        if (this.state === StreamingFetch.UNINITIALIZED) {
            throw new Error('StreamingFetch not started')
        } else if (this.state === StreamingFetch.CLOSED || this.state === StreamingFetch.QUERYING) {
            this.state = StreamingFetch.CLOSED
            return
        }
        this.close()
    }
}

StreamingFetch.UNINITIALIZED = 0
StreamingFetch.QUERYING = 1
StreamingFetch.STREAMING = 2
StreamingFetch.CLOSED = 3

export function useStreamingEndpoint(endpoint) {
    const [stream, setStream] = useState(null)
    const [results, setResults] = useState([])
    const [error, setError] = useState(null)
    const [metadata, setMetadata] = useState(null)

    const onResult = (data) => {
        if (data.event == "metadata") {
            setMetadata(data.data)
            return
        }

        setResults(results => [...results, data])
    }

    const onError = (error) => {
        setError(error)
        cancel();
    }

    const onClose = () => {
        setStream(null)
    }

    const cancel = () => {
        if (!stream) {
            return
        }
        stream.cancel()
        setStream(null)
    }

    const fetch = (payload) => {
        if (stream) {
            return
        }

        setResults([])
        setError(null)
        setMetadata(null)

        let r = new StreamingFetch(endpoint, payload)
        r.onresult(onResult)
        r.onerror(onError)
        r.onclose(onClose)

        r.start()

        setStream(r)
    }

    const state = stream ? stream.state : null

    return [state, results, metadata, error, fetch, cancel]
}
