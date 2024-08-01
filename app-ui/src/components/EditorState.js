import { AgentRequest } from "./AgentRequest";

export class EditorState {
    constructor(file, messages = []) {
        this.file = file;
        // loading | loaded
        this.state = "loading"
        // code of the workflow
        // user chat messages
        this.messages = messages;
        this.activeMessage = null;
        // indicates whether the active message was selected automatically
        this.activeMessageAutomated = false;
        
        try {
            this.settings = JSON.parse(localStorage.getItem('editor-settings')) || {};
        } catch (e) {
            this.settings = {};
        }
        this.dirty = false;

        // execution state
        this.execution_running = false;
        this.execution_session = null;
        // list of execution steps
        this.execution_steps = [];
        // currently highlighted problem
        this.highlightedProblem = null;
        
        // state listeners
        this.loadedListeners = [];
        this.executionListeners = [];
        this.selectedMessageListeners = [];
        this.settingsListeners = [];
        this.planningListeners = [];
        this.highlightedProblemListeners = [];
        
        // whether the editor is read-only
        this.readOnly = false;
    }

    onHighlightProblem(callback) {
        this.highlightedProblemListeners.push(callback);
    }

    offHighlightProblem(callback) {
        this.highlightedProblemListeners = this.highlightedProblemListeners.filter(cb => cb !== callback);
    }

    highlightProblem(problem) {
        this.highlightedProblem = problem;
        this.highlightedProblemListeners.forEach(cb => cb(problem));
    }

    onPlanning(callback) {
        this.planningListeners.push(callback);
    }

    offPlanning(callback) {
        this.planningListeners = this.planningListeners.filter(cb => cb !== callback);
    }

    onExecution(callback) {
        this.executionListeners.push(callback);
    }

    offExecution(callback) {
        this.executionListeners = this.executionListeners.filter(cb => cb !== callback);
    }

    onSettingsChanged(callback) {
        this.settingsListeners.push(callback);
    }

    offSettingsChanged(callback) {
        this.settingsListeners = this.settingsListeners.filter(cb => cb !== callback);
    }

    setSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem('editor-settings', JSON.stringify(this.settings));
        this.settingsListeners.forEach(cb => cb(this.settings));
    }

    onSelectedMessage(callback) {
        this.selectedMessageListeners.push(callback);
    }

    offSelectedMessage(callback) {
        this.selectedMessageListeners = this.selectedMessageListeners.filter(cb => cb !== callback);
    }

    selectMessage(messageKey) {
        this.activeMessage = messageKey;
        this.activeMessageAutomated = messageKey === null;
        this.selectedMessageListeners.forEach(cb => cb(this.activeMessage));
    }

    autoselectMessage(messageKey) {
        if (!this.activeMessageAutomated && this.activeMessage !== null) {
            return;
        }
        this.activeMessage = messageKey;
        this.activeMessageAutomated = true;
        this.selectedMessageListeners.forEach(cb => cb(this.activeMessage));
    }

    onLoaded(callback) {
        this.loadedListeners.push(callback);
    }

    offLoaded(callback) {
        this.loadedListeners = this.loadedListeners.filter(cb => cb !== callback);
    }

    load(file) {
        this.file = file;
        this.messages = [];
        this.dirty = false;
        this.state = "loading";
        
        fetch(`/api/projects/${this.file}`)
            .then(response => response.json())
            .then(data => {
                this.loadProject(data)
            });
    }

    loadProject(data, file="tmp.md") {
        this.file = file;
        this.messages = [];
        this.dirty = false;
        this.state = "loading";
        
        this.populate(data);
        this.loadedListeners.forEach(cb => cb(this));
    }

    setMessages(messages) {
        if (typeof messages === 'function') {
            messages = messages(this.messages);
        }

        this.messages = messages;
        this.dirty = true;
        this.loadedListeners.forEach(cb => cb(this));
    }

    plan(history, plannerId) {
        this.planningListeners.forEach(cb => cb({
            type: 'status',
            running: true
        }));

        let session = new AgentRequest(plannerId, history)

        this.setMessages(history);

        function merge(messages, new_message) {
            // if new_message is assistant, consolidate with last assistant message
            if (new_message.role === 'assistant') {
                if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
                    let updated_messages = [...messages];
                    updated_messages[messages.length - 1] = {
                        ...messages[messages.length - 1],
                        content: messages[messages.length - 1].content + new_message.content
                    }
                    return [updated_messages, true];
                }
            }
            return [[...messages, new_message], false];
        }

        const onstep = (step) => {
            let incremental = false;
            this.setMessages(messages => {
                let [updated, change_was_incremental] = merge(messages, step.message)
                incremental = change_was_incremental;
                return updated;
            });
            step['incremental'] = incremental;
            this.planningListeners.forEach(cb => cb(step));
        }

        const onstatus = (status, data) => {
            if (status == 'state') {
                this.planningListeners.forEach(cb => cb({
                    type: 'status',
                    ...data
                }));
            } else if (status == 'error') {
                this.planningListeners.forEach(cb => cb({
                    type: 'error',
                    message: data
                }));
            } else {
                console.error('Unhandled planning status', status, data);
            }
        };

        // setup listeners 
        session.onstep = (message) => {
            if (message.type == "error") {
                onstatus('error', message);
                onstep({
                    type: 'error',
                    message: {
                        role: 'error',
                        message: message.details
                    }
                });
            } else {
                onstep(message);
            }
        };

        session.onerror = (error) => {
            onstep({
                type: 'error',
                message: {
                    role: 'error',
                    content: error.message
                }
            });
            onstatus('state', { running: false });
        }

        session.onclose = () => {
            onstatus('state', { running: false });
        }

        // start the planning session
        session.run();

        return session;
    }

    verify(message_key) {
        alert('verify() not implemented');
    }

    run(message_key, verify_only = false) {
       alert('run() not implemented');
    }

    save() {
        if (!this.dirty) {
            return;
        }
        fetch(`/api/projects/${this.file}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: this.messages })
        }).then(() => {
            this.dirty = false;
            this.loadedListeners.forEach(cb => cb(this));
        });
    
    }

    populate(data) {
        if (data.messages) {
            this.messages = data.messages;
        }
        this.state = "loaded";
        this.activeMessage = null;
        this.dirty = false;
        
        this.execution_running = false;
        this.execution_session = null;
        this.execution_steps = [];
    }
}