import type { APIRoute } from 'astro';
import { Octokit } from '@octokit/rest';
import { env } from 'cloudflare:workers';

// Folder inside the GitHub repo where uploaded images live.
// Kept outside `public/` so image uploads don't require a site rebuild —
// they're served straight off GitHub via the jsDelivr CDN instead.
const IMAGE_FOLDER = 'uploads';

// Basic guardrails so this endpoint can't be used to smuggle arbitrary files
// into the repo or blow past GitHub's per-file size limits.
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, comfortably under GitHub's 100MB (and Contents API's ~1MB base64-in-JSON sweet spot -> bump if you need more, see note below)

function sanitizeFilename(name: string): { base: string; ext: string } {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const base = name
        .slice(0, name.length - ext.length - 1)
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return { base: base || 'image', ext };
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const ADMIN_ARTICLEKEY = (env as any).ADMIN_ARTICLEKEY || import.meta.env.ADMIN_ARTICLEKEY;
        const ADMIN_BLOGKEY = (env as any).ADMIN_BLOGKEY || import.meta.env.ADMIN_BLOGKEY;
        const GITHUB_TOKEN = (env as any).GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN;
        const GITHUB_REPO = (env as any).GITHUB_REPO || import.meta.env.GITHUB_REPO;
        const GITHUB_BRANCH = (env as any).GITHUB_BRANCH || import.meta.env.GITHUB_BRANCH || 'main';

        const { filename, base64, key } = (await request.json()) as {
            filename: string;
            base64: string; // raw base64, no data: prefix
            key?: string;
        };

        if (!filename || !base64) {
            return new Response(
                JSON.stringify({ message: 'Missing filename or image data.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Accept either admin key — the image library is shared across blog + article editors.
        if (!key || (key !== ADMIN_ARTICLEKEY && key !== ADMIN_BLOGKEY)) {
            return new Response(
                JSON.stringify({ message: 'Unauthorized: Invalid or missing API key.' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            return new Response(
                JSON.stringify({ message: 'Server environment misconfigured.' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const { base, ext } = sanitizeFilename(filename);
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return new Response(
                JSON.stringify({ message: `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Rough size check on the base64 payload (base64 is ~4/3 the size of raw bytes).
        const approxBytes = Math.ceil((base64.length * 3) / 4);
        if (approxBytes > MAX_BYTES) {
            return new Response(
                JSON.stringify({ message: `Image too large. Max ${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB.` }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Prefix with a timestamp so re-uploading a same-named file never collides.
        const uniqueName = `${Date.now()}-${base}.${ext}`;
        const filePath = `${IMAGE_FOLDER}/${uniqueName}`;

        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        const [owner, repo] = GITHUB_REPO.split('/');

        const result = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filePath,
            message: `content: upload image ${uniqueName}`,
            content: base64,
            branch: GITHUB_BRANCH,
        });

        // Served via jsDelivr's GitHub CDN so it's available immediately without
        // waiting on the Astro site's own build/deploy.
        const cdnUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${GITHUB_BRANCH}/${filePath}`;

        return new Response(
            JSON.stringify({
                message: 'Image uploaded.',
                url: cdnUrl,
                path: filePath,
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
