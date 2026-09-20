import type { APIRoute } from 'astro';
import { Octokit } from '@octokit/rest';
import { env } from 'cloudflare:workers';

const IMAGE_FOLDER = 'uploads';
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

// Read-only listing, intentionally unauthenticated: it only returns filenames
// and CDN URLs for images that are already going to be embedded in public
// blog/article pages, so there's nothing sensitive to gate here.
export const GET: APIRoute = async () => {
    try {
        const GITHUB_TOKEN = (env as any).GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN;
        const GITHUB_REPO = (env as any).GITHUB_REPO || import.meta.env.GITHUB_REPO;
        const GITHUB_BRANCH = (env as any).GITHUB_BRANCH || import.meta.env.GITHUB_BRANCH || 'main';

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            return new Response(
                JSON.stringify({ message: 'Server environment misconfigured.' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        const [owner, repo] = GITHUB_REPO.split('/');

        let files: any[] = [];
        try {
            const res = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: IMAGE_FOLDER,
                ref: GITHUB_BRANCH,
            });
            files = Array.isArray(res.data) ? res.data : [];
        } catch (error: any) {
            // Folder doesn't exist yet (no images uploaded) — treat as empty library.
            if (error.status !== 404) throw error;
        }

        const images = files
            .filter((f) => f.type === 'file' && IMAGE_EXT_RE.test(f.name))
            .map((f) => ({
                name: f.name,
                url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${GITHUB_BRANCH}/${IMAGE_FOLDER}/${f.name}`,
            }))
            .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest-first, since names are timestamp-prefixed

        return new Response(JSON.stringify({ images }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        return new Response(
            JSON.stringify({ message: error.message || 'Server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
