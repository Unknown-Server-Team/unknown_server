// Page transition handler
class PageTransition {
    constructor() {
        this.progressBar = null;
        this.loadingOverlay = null;
        this.init();
    }

    init() {
        this.createElements();
        this.attachListeners();
    }

    createElements() {
        // Create loading overlay
        this.loadingOverlay = document.createElement('div');
        this.loadingOverlay.className = 'loading-overlay hidden';
        this.loadingOverlay.innerHTML = `
            <div class="loading-circle"></div>
            <div class="loading-text">Loading...</div>
        `;

        // Create progress bar
        this.progressBar = document.createElement('div');
        this.progressBar.className = 'loading-progress';
        this.progressBar.innerHTML = '<div class="loading-progress-bar"></div>';

        document.body.appendChild(this.loadingOverlay);
        document.body.appendChild(this.progressBar);
    }

    attachListeners() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href.startsWith(window.location.origin)) {
                e.preventDefault();
                this.navigateTo(link.href);
            }
        });

        window.addEventListener('popstate', () => {
            this.navigateTo(window.location.href, true);
        });
    }

    async navigateTo(url, isPopState = false) {
        this.showProgress();
        
        try {
            const response = await fetch(url);
            const html = await response.text();
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Update the content
            const content = doc.querySelector('.container');
            document.querySelector('.container').innerHTML = content.innerHTML;
            
            // Update title
            document.title = doc.title;
            
            if (!isPopState) {
                history.pushState({}, '', url);
            }
            
            // Reinitialize particles and other scripts
            this.reinitializeScripts();
        } catch (error) {
            console.error('Navigation error:', error);
        } finally {
            this.hideProgress();
        }
    }

    showProgress() {
        const bar = this.progressBar.querySelector('.loading-progress-bar');
        bar.style.width = '0%';
        
        // Simulate progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress > 90) clearInterval(interval);
            bar.style.width = Math.min(progress, 90) + '%';
        }, 500);
        
        this.progressInterval = interval;
    }

    hideProgress() {
        clearInterval(this.progressInterval);
        const bar = this.progressBar.querySelector('.loading-progress-bar');
        bar.style.width = '100%';
        
        setTimeout(() => {
            bar.style.width = '0%';
        }, 300);
    }

    reinitializeScripts() {
        // Reinitialize particles
        if (window.particleSystem) {
            window.particleSystem.destroy();
        }
        const canvas = document.getElementById('particles');
        if (canvas) {
            window.particleSystem = new ParticleSystem(canvas);
        }

        // Reinitialize tilt effect
        if (typeof VanillaTilt !== 'undefined') {
            VanillaTilt.init(document.querySelectorAll("[data-tilt]"), {
                max: 5,
                speed: 400,
                glare: true,
                "max-glare": 0.2,
            });
        }
    }
}

// Initialize page transition system
document.addEventListener('DOMContentLoaded', () => {
    window.pageTransition = new PageTransition();
});