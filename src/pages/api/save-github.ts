import type { APIRoute } from 'astro';
import { Octokit } from '@octokit/rest';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
    try {
        const ADMIN_ARTICLEKEY = (env as any).ADMIN_ARTICLEKEY || import.meta.env.ADMIN_ARTICLEKEY;
        const ADMIN_BLOGKEY = (env as any).ADMIN_BLOGKEY || import.meta.env.ADMIN_BLOGKEY;
        const GITHUB_TOKEN = (env as any).GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN;
        const GITHUB_REPO = (env as any).GITHUB_REPO || import.meta.env.GITHUB_REPO;
        const GITHUB_BRANCH = (env as any).GITHUB_BRANCH || import.meta.env.GITHUB_BRANCH || 'main';

        const { slug, content, type = 'blog', key } = (await request.json()) as {
            slug: string;
            content: string;
            type?: 'blog' | 'article';
            key?: string; // Add key to the payload definition
        };

        if (!slug || !content) {
            return new Response(
                JSON.stringify({ message: 'Missing slug or content.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // --- NEW: API Key Verification ---
        const expectedKey = type === 'article' ? ADMIN_ARTICLEKEY : ADMIN_BLOGKEY;

        if (!expectedKey || key !== expectedKey) {
            return new Response(
                JSON.stringify({ message: 'Unauthorized: Invalid or missing API key.' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }
        // ---------------------------------

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            return new Response(
                JSON.stringify({ message: 'Server environment misconfigured.' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        const [owner, repo] = GITHUB_REPO.split('/');

        // Determine destination folder based on the requested content type
        const folder = type === 'article' ? 'article' : 'blog';
        const filePath = `src/content/${folder}/${slug}.md`;

        // Check if file already exists
        let fileSha: string | undefined;
        try {
            const existingFile = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: filePath,
                ref: GITHUB_BRANCH,
            });

            if (!Array.isArray(existingFile.data) && 'sha' in existingFile.data) {
                fileSha = existingFile.data.sha;
            }
        } catch (error: any) {
            if (error.status !== 404) throw error;
        }

        // Commit file to repository
        const result = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filePath,
            message: `content: publish ${type} ${slug}.md`,
            content: btoa(unescape(encodeURIComponent(content))),
            branch: GITHUB_BRANCH,
            sha: fileSha,
        });

        return new Response(
            JSON.stringify({
                message: `Successfully committed ${type} to GitHub`,
                commitUrl: result.data.commit.html_url,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error: any) {
        return new Response(
            JSON.stringify({ message: error.message || 'Server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};