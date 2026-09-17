// @ts-checks
import { defineConfig } from 'astro/config';

// https://astro.build/config

import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
    trailingSlash: 'ignore',
    output: 'server', // or 'hybrid'
    adapter: cloudflare(),
});