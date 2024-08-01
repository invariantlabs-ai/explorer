class LineDecoder {
    constructor() {
        this.textDecoder = new TextDecoder();
        this.buffer = ""
        this.ready = []
    }

    decode(value, done) {
        let response = this.textDecoder.decode(value, { stream: true });
        let lines = response.split("\n");

        lines = lines.filter((l,i)  => {
            if (i==0 && l.startsWith(":") && this.buffer == "") {
                return false;
            } else if (l.startsWith(":")) {
                return false;
            }
            return true;
        });

        if (lines.length < 2) {
            this.buffer += lines[0];
            this.ready = [];
        } else {
            lines[0] = this.buffer + lines[0];
            this.buffer = lines.pop();
            this.ready = lines;
        }
        
        if (done) {
            this.ready.push(this.buffer);
            this.buffer = "";
        }
        
        return this.ready;
    }
}

class PostEventSource {
    constructor(url, options) {
        this.url = url;
        this.options = options;

        this.onmessage = () => {};
        this.onerror = () => {};
        this.onclose = () => {};

        this.abortController = new AbortController();
        this.options.signal = this.abortController.signal;
    }

    close() {
        this.abortController.abort();
        this.onclose();
    }

    open() {
        let that = this;

        // use custom SSE via fetch and result streaming
        fetch(this.url, this.options)
            .then(response => {
                if (response.status == 429) { // too many requests
                    throw new Error("The competition or your IP has reached the rate limit. Please try again in a few minutes or play another competition.");
                }
                return response;
            })
            .then(response => response.body)
            .then(body => {
                const reader = body.getReader();
                const decoder = new LineDecoder();

                function next(value, done) {
                    reader.read().then(({ value, done }) => {
                        const ready = decoder.decode(value, done);
                        ready.forEach(v => {
                            if (v.length == 0) {
                                return;
                            }
                            if (v.startsWith("data:")) {
                                that.onmessage({
                                    data: v.substring(5)
                                });
                            } else {
                                if (v.includes("Authorization")) {
                                    that.onerror(new Error("You are not authorized to submit to this competition. Please check your API key."))
                                    return;
                                }
                            }
                        });
                        if (done) {
                            that.onclose();
                            return;
                        }
                        window.setTimeout(next, 0);
                    }).catch(error => {
                        that.onerror(error);
                    })
                }
                next();
            })
            .catch(error => {
                if (error.name === 'AbortError') {
                    return;
                }
                that.onerror(error);
            });
    }
}

export class AgentRequest {
    constructor(planner, messages) {
        this.planner = planner;
        this.messages = messages;
        
        this.readyState = AgentRequest.READY;
        
        // SSE-events POST endpoint
        const endpoint = window.location.protocol + "//" + window.location.host + '/api/v1/plan';

        // POST request options
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // authentication is handled via HTTP cookie JWT, no need to send an API key
            },
            body: JSON.stringify({
                planner: this.planner,
                messages: this.messages
            }),
        };

        // create new event source
        this.eventSource = new PostEventSource(endpoint, options);
        this.eventSource.onmessage = this.onmessage.bind(this);
        this.eventSource.onerror = this._onerror.bind(this);
        this.eventSource.onclose = this._onclose.bind(this);

        this.onstep = () => {};
        this.onerror = () => {};
        this.onclose = () => {};
    }

    run() {
        this.readyState = AgentRequest.RUNNING;
        this.eventSource.open();
    }

    onmessage(data) {
        try {
            this.onstep(JSON.parse(data.data))
        } catch {
            console.error('error parsing', data)
        }
    }

    _onerror(error) {
        this.readyState = AgentRequest.DONE;
        
        if (error.name === 'AbortError') {
            return;
        } else {
            this.onerror(error);
        }
    }

    _onclose() {
        this.readyState = AgentRequest.DONE;
        this.onclose();
    }

    cancel() {
        this.eventSource.close();
        this.readyState = AgentRequest.DONE;
    }
}

AgentRequest.READY = 'ready';
AgentRequest.RUNNING = 'running';
AgentRequest.DONE = 'done';