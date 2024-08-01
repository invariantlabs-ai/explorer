export class PlanningSession {
    constructor() {
        this.socket = null;

        this.onstepListeners = [];
        this.statusListeners = [];
        this.readyQueue = [];
    }

    ensureConnected(callback) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.connect();
        }
        if (this.socket.readyState === WebSocket.OPEN) {
            callback();
        } else {
            this.readyQueue.push(callback);
        }
    }

    connect() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }

        const endpoint = window.location.host + '/api/plan';
        this.socket = new WebSocket('ws://' + endpoint);
        this.socket.onopen = this.onopen.bind(this);
        this.socket.onmessage = this.onmessage.bind(this);
        this.socket.onclose = this.onclose.bind(this);
    }

    onopen() {
        this.statusListeners.forEach(cb => cb("state", "connected"));
        if (this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.readyQueue.forEach(cb => cb());
        this.readyQueue = [];
    }

    onmessage(event) {
        let message = null;
        try {
            message = JSON.parse(event.data);
        } catch (e) { 
            this.statusListeners.forEach(cb => cb('error', e));
            return;
        }

        if (message.type === 'step') {
            this.onstepListeners.forEach(cb => cb(message));
        } else if (message.type === 'status') {
            this.statusListeners.forEach(cb => cb('state', message.status));
        } else if (message.type === 'result') {
            this.onstepListeners.forEach(cb => cb({
                message: {
                    role: 'result',
                    content: message.message
                }
            }));
        } else if (message.type === 'authenticate') {
            this.statusListeners.forEach(cb => cb('authenticate', message));
        } else {
            this.statusListeners.forEach(cb => cb('error', 'Unknown message type: ' + message.type));
        }
    }

    onclose() {
        this.statusListeners.forEach(cb => cb('state', 'disconnected'));
    }

    // sets planning history for this session
    setHistory(history) {
        this.ensureConnected(() => {
            this.socket.send(JSON.stringify({type: 'history', history}));
        })
    }

    setPlanner(planner) {
        this.ensureConnected(() => {
            this.socket.send(JSON.stringify({type: 'set-planner', planner}));
        });
    }

    setExecuteDirectly(value) {
        this.ensureConnected(() => {
            this.socket.send(JSON.stringify({"type": 'set-execute', "execute": value}));
        });
    }

    plan() {
        this.ensureConnected(() => {
            this.socket.send(JSON.stringify({type: 'start'}));
        });
    }

    cancel() {
        this.ensureConnected(() => {
            this.socket.send(JSON.stringify({type: 'cancel'}));
        });
    }

    close() {
        this.socket.close();
    }

    onStep(callback) {
        this.onstepListeners.push(callback);
    }

    offStep(callback) {
        this.onstepListeners = this.onstepListeners.filter(cb => cb !== callback);
    }

    onStatus(callback) {
        this.statusListeners.push(callback);
    }

    offStatus(callback) {
        this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
    }
}