import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
    loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
    schema: z.object({
        title: z.string(),
        slug: z.string(),
        desc: z.string(),
        pubDate: z.date(),
        author: z.string(),
        banner: z.string().optional(),
    }),
});

const article = defineCollection({
    loader: glob({ base: "./src/content/article", pattern: "**/*.md" }),
    schema: z.object({
        title: z.string(),
        slug: z.string(),
        desc: z.string(),
        pubDate: z.date(),
        author: z.string(),
        tags: z.array(z.string()).default([]),
        banner: z.string().optional(),
    }),
});

export const collections = { blog, article };