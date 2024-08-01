class Appearance {
    constructor() {
        this.appearanceListeners = [];
        this.darkMode = localStorage.getItem('darkmode') === 'true';
        this.apply();
    }

    onAppearance(callback) {
        this.appearanceListeners.push(callback);
    }

    offAppearance(callback) {
        this.appearanceListeners = this.appearanceListeners.filter(cb => cb !== callback);
    }

    setDarkMode(value) {
        this.darkMode = value;
        localStorage.setItem('darkmode', value);
        this.appearanceListeners.forEach(cb => cb(value));
        this.apply();
    }

    apply() {
        if (this.darkMode) {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
    }
}

export const appearance = new Appearance();