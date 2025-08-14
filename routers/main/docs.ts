import express, { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { marked } from 'marked';

const router: Router = express.Router();

// Initialize markdown renderer
marked.setOptions({
    highlight: function(code: string, lang: string) {
        return code;
    }
});

// Render markdown files as HTML
async function renderMarkdown(filePath: string): Promise<string> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return marked.parse(content);
    } catch (error) {
        console.error(`Error reading markdown file: ${error}`);
        throw error;
    }
}

// Documentation route handler
async function renderDocumentation(filePath: string, title: string) {
    return async (req: Request, res: Response) => {
        try {
            const markdown = await renderMarkdown(path.join(__dirname, filePath));
            res.render('documentation', { 
                title,
                content: markdown
            });
        } catch (error) {
            res.status(500).render('error', { error });
        }
    };
}

// Documentation routes
router.get('/api', renderDocumentation('../../docs/api.md', 'API Reference'));

router.get('/deployment', renderDocumentation('../../docs/deployment.md', 'Deployment Guide'));

router.get('/security', renderDocumentation('../../docs/security.md', 'Security Guide'));

router.get('/roles-and-permissions', renderDocumentation('../../docs/roles-and-permissions.md', 'Roles and Permissions Guide'));

export = router;