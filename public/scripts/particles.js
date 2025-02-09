if (typeof window !== 'undefined' && !window.ParticleSystem) {
    class ParticleSystem {
        static PARAMS = {
            particleCount: 100,
            particleSize: 2,
            minSpeed: 0.1,
            maxSpeed: 0.3,
            connectionDistance: 150,
            colors: ['#9B4BFF', '#E84BFF'],
            connectionOpacity: 0.15
        };

        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.particles = [];
            this.isActive = true;
            this.mouse = { x: null, y: null, radius: 150 };
            this.init();
        }

        init() {
            this.resize();
            window.addEventListener('resize', () => this.resize());
            this.createParticles();
            this.addMouseInteraction();
            this.animate();
        }

        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        createParticles() {
            for (let i = 0; i < ParticleSystem.PARAMS.particleCount; i++) {
                this.particles.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height,
                    size: Math.random() * ParticleSystem.PARAMS.particleSize + 1,
                    speedX: (Math.random() - 0.5) * (ParticleSystem.PARAMS.maxSpeed - ParticleSystem.PARAMS.minSpeed) + ParticleSystem.PARAMS.minSpeed,
                    speedY: (Math.random() - 0.5) * (ParticleSystem.PARAMS.maxSpeed - ParticleSystem.PARAMS.minSpeed) + ParticleSystem.PARAMS.minSpeed,
                    color: ParticleSystem.PARAMS.colors[Math.floor(Math.random() * ParticleSystem.PARAMS.colors.length)]
                });
            }
        }

        addMouseInteraction() {
            this.canvas.addEventListener('mousemove', (e) => {
                this.mouse.x = e.x;
                this.mouse.y = e.y;
            });

            this.canvas.addEventListener('mouseleave', () => {
                this.mouse.x = null;
                this.mouse.y = null;
            });
        }

        drawConnections() {
            for (let i = 0; i < this.particles.length; i++) {
                for (let j = i + 1; j < this.particles.length; j++) {
                    const dx = this.particles[i].x - this.particles[j].x;
                    const dy = this.particles[i].y - this.particles[j].y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < ParticleSystem.PARAMS.connectionDistance) {
                        const opacity = (1 - distance / ParticleSystem.PARAMS.connectionDistance) * ParticleSystem.PARAMS.connectionOpacity;
                        this.ctx.beginPath();
                        this.ctx.strokeStyle = `rgba(155, 75, 255, ${opacity})`;
                        this.ctx.lineWidth = 1;
                        this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                        this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                        this.ctx.stroke();
                    }
                }
            }
        }

        update() {
            this.particles.forEach(particle => {
                // Update position
                particle.x += particle.speedX;
                particle.y += particle.speedY;

                // Mouse interaction
                if (this.mouse.x) {
                    const dx = this.mouse.x - particle.x;
                    const dy = this.mouse.y - particle.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < this.mouse.radius) {
                        const force = (this.mouse.radius - distance) / this.mouse.radius;
                        particle.x -= dx * force * 0.03;
                        particle.y -= dy * force * 0.03;
                    }
                }

                // Wrap around screen
                if (particle.x < 0) particle.x = this.canvas.width;
                if (particle.x > this.canvas.width) particle.x = 0;
                if (particle.y < 0) particle.y = this.canvas.height;
                if (particle.y > this.canvas.height) particle.y = 0;
            });
        }

        draw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw connections first
            this.drawConnections();

            // Draw particles
            this.particles.forEach(particle => {
                this.ctx.beginPath();
                this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                this.ctx.fillStyle = particle.color;
                this.ctx.fill();
            });
        }

        animate() {
            if (!this.isActive) return;

            this.update();
            this.draw();
            requestAnimationFrame(() => this.animate());
        }

        destroy() {
            this.isActive = false;
        }
    }

    // Initialize when DOM is loaded
    window.ParticleSystem = ParticleSystem;
    document.addEventListener('DOMContentLoaded', () => {
        const canvas = document.getElementById('particles');
        if (canvas) {
            window.particleSystem = new ParticleSystem(canvas);
        }
    });
}