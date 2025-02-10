const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const marked = require('marked');

// Initialize markdown renderer
marked.setOptions({
    highlight: function(code, lang) {
        return code;
    }
});

// Render markdown files as HTML
async function renderMarkdown(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return marked.parse(content);
    } catch (error) {
        console.error(`Error reading markdown file: ${error}`);
        throw error;
    }
}

// Documentation routes
router.get('/api', async (req, res) => {
    try {
        const markdown = await renderMarkdown(path.join(__dirname, '../../docs/api.md'));
        res.render('documentation', { 
            title: 'API Reference',
            content: markdown
        });
    } catch (error) {
        res.status(500).render('error', { error });
    }
});

router.get('/deployment', async (req, res) => {
    try {
        const markdown = await renderMarkdown(path.join(__dirname, '../../docs/deployment.md'));
        res.render('documentation', { 
            title: 'Deployment Guide',
            content: markdown
        });
    } catch (error) {
        res.status(500).render('error', { error });
    }
});

router.get('/security', async (req, res) => {
    try {
        const markdown = await renderMarkdown(path.join(__dirname, '../../docs/security.md'));
        res.render('documentation', { 
            title: 'Security Guide',
            content: markdown
        });
    } catch (error) {
        res.status(500).render('error', { error });
    }
});

module.exports = router;