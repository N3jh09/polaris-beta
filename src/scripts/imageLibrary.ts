// Shared image-library picker for Quill's toolbar image button.
// Replaces Quill's default "paste a URL" prompt with:
//   - a grid of images already uploaded to the GitHub repo (via /api/list-images)
//   - a file input that uploads a new image (via /api/upload-image) and inserts it
//
// Usage in an admin page's client script:
//   import { setupImageHandler } from "../../scripts/imageLibrary";
//   setupImageHandler(quill, () => (document.getElementById("keyCode") as HTMLInputElement).value);

type QuillLike = {
    getModule: (name: string) => any;
    getSelection: (focus?: boolean) => { index: number; length: number } | null;
    insertEmbed: (index: number, type: string, value: unknown, source?: string) => void;
};

let modalEl: HTMLDivElement | null = null;

function ensureModal(): HTMLDivElement {
    if (modalEl) return modalEl;

    const overlay = document.createElement('div');
    overlay.className = 'img-lib-overlay';
    overlay.innerHTML = `
        <div class="img-lib-modal">
            <div class="img-lib-header">
                <h4>Image Library</h4>
                <button type="button" class="img-lib-close" aria-label="Close">&times;</button>
            </div>
            <div class="img-lib-upload">
                <label class="img-lib-upload-btn">
                    Upload new image
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden />
                </label>
                <span class="img-lib-status"></span>
            </div>
            <div class="img-lib-grid"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    modalEl = overlay;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    overlay.querySelector('.img-lib-close')?.addEventListener('click', closeModal);

    if (!document.getElementById('img-lib-styles')) {
        const style = document.createElement('style');
        style.id = 'img-lib-styles';
        style.textContent = `
            .img-lib-overlay {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
                align-items: center;
                justify-content: center;
            }
            .img-lib-overlay.open { display: flex; }
            .img-lib-modal {
                background: #fff;
                width: min(640px, 92vw);
                max-height: 80vh;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .img-lib-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid #eee;
            }
            .img-lib-header h4 { margin: 0; }
            .img-lib-close {
                background: none;
                border: none;
                font-size: 1.4rem;
                line-height: 1;
                cursor: pointer;
                color: #333;
            }
            .img-lib-upload {
                padding: 12px 16px;
                border-bottom: 1px solid #eee;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .img-lib-upload-btn {
                background: #000957;
                color: #fff;
                padding: 0.5rem 0.9rem;
                border-radius: 4px;
                font-size: 0.9rem;
                cursor: pointer;
            }
            .img-lib-status { font-size: 0.85rem; color: #555; }
            .img-lib-grid {
                padding: 16px;
                overflow-y: auto;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
                gap: 10px;
            }
            .img-lib-thumb {
                cursor: pointer;
                border: 1px solid #ddd;
                border-radius: 6px;
                overflow: hidden;
                aspect-ratio: 1 / 1;
                background: #f5f5f5;
            }
            .img-lib-thumb img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .img-lib-empty { color: #888; font-size: 0.9rem; padding: 8px 0; }
        `;
        document.head.appendChild(style);
    }

    return overlay;
}

function closeModal() {
    modalEl?.classList.remove('open');
}

async function loadGrid(overlay: HTMLDivElement, onPick: (url: string) => void) {
    const grid = overlay.querySelector('.img-lib-grid') as HTMLDivElement;
    grid.innerHTML = `<p class="img-lib-empty">Loading…</p>`;

    try {
        const res = await fetch('/api/list-images');
        const data = (await res.json()) as { images?: { name: string; url: string }[]; message?: string };

        if (!res.ok) {
            grid.innerHTML = `<p class="img-lib-empty">${data.message || 'Failed to load library.'}</p>`;
            return;
        }

        const images = data.images ?? [];
        if (images.length === 0) {
            grid.innerHTML = `<p class="img-lib-empty">No images uploaded yet.</p>`;
            return;
        }

        grid.innerHTML = '';
        for (const img of images) {
            const thumb = document.createElement('div');
            thumb.className = 'img-lib-thumb';
            thumb.innerHTML = `<img src="${img.url}" alt="${img.name}" loading="lazy" />`;
            thumb.addEventListener('click', () => onPick(img.url));
            grid.appendChild(thumb);
        }
    } catch {
        grid.innerHTML = `<p class="img-lib-empty">Network error loading library.</p>`;
    }
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Strip the "data:image/png;base64," prefix — API wants raw base64.
            resolve(result.split(',')[1] ?? '');
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export function openImageLibrary(opts: { getKey: () => string; onPick: (url: string) => void }) {
    const overlay = ensureModal();
    const statusEl = overlay.querySelector('.img-lib-status') as HTMLSpanElement;
    const fileInput = overlay.querySelector('input[type="file"]') as HTMLInputElement;
    statusEl.textContent = '';
    fileInput.value = '';

    const pickAndClose = (url: string) => {
        opts.onPick(url);
        closeModal();
    };

    loadGrid(overlay, pickAndClose);

    // Re-bind the upload handler fresh each open so we don't stack listeners.
    const newFileInput = fileInput.cloneNode(true) as HTMLInputElement;
    fileInput.replaceWith(newFileInput);
    newFileInput.addEventListener('change', async () => {
        const file = newFileInput.files?.[0];
        if (!file) return;

        const key = opts.getKey();
        if (!key) {
            statusEl.textContent = 'Enter the admin key before uploading.';
            return;
        }

        statusEl.textContent = 'Uploading…';
        try {
            const base64 = await fileToBase64(file);
            const res = await fetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, base64, key }),
            });
            const data = (await res.json()) as { url?: string; message?: string };

            if (!res.ok || !data.url) {
                statusEl.textContent = data.message || 'Upload failed.';
                return;
            }

            statusEl.textContent = 'Uploaded!';
            pickAndClose(data.url);
        } catch {
            statusEl.textContent = 'Network error during upload.';
        }
    });

    overlay.classList.add('open');
}

export function setupImageHandler(quill: QuillLike, getKey: () => string) {
    quill.getModule('toolbar').addHandler('image', () => {
        openImageLibrary({
            getKey,
            onPick: (url) => {
                const range = quill.getSelection(true);
                const index = range ? range.index : 0;
                quill.insertEmbed(index, 'image', url, 'user');
            },
        });
    });
}
