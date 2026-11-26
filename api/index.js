// Vercel serverless entry for CinePro Core.
//
// Upstream src/server.ts boots a plain Node server (app.listen() + fs-based
// provider discovery), which cannot run on serverless as-is. This wrapper
// boots the same OMSS server without listen() and serves requests through
// the Fastify instance, so it works as a Vercel Serverless Function.
import { OMSSServer } from '@omss/framework';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownThirdPartyProxies } from '../dist/thirdPartyProxies.js';
import { streamPatterns } from '../dist/streamPatterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build-time hint for Vercel's file tracer (nft): include the compiled
// providers directory in the function bundle. At runtime this path usually
// does not exist, so failures are ignored.
try {
    fs.readdirSync(path.join(__dirname, '../dist/providers'));
} catch {}

function providersDir() {
    const candidates = [
        path.join(__dirname, 'dist/providers'),
        path.join(__dirname, '../dist/providers'),
        path.join(process.cwd(), 'dist/providers')
    ];
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isDirectory()) return c;
        } catch {}
    }
    return candidates[0];
}

let appPromise = null;

function bootApp() {
    if (appPromise) return appPromise;
    appPromise = (async () => {
        const server = new OMSSServer({
            name: 'CinePro',
            version: '1.0.0',

            // Network (host/port unused on serverless; no listen() call)
            host: process.env.HOST ?? 'localhost',
            port: Number(process.env.PORT ?? 3000),
            publicUrl: process.env.PUBLIC_URL,

            // Cache (memory for dev, Redis for prod)
            cache: {
                type: process.env.CACHE_TYPE ?? 'memory',
                ttl: {
                    sources: 60 * 60,
                    subtitles: 60 * 60 * 24
                },
                redis: {
                    host: process.env.REDIS_HOST ?? 'localhost',
                    port: Number(process.env.REDIS_PORT ?? 6379),
                    password: process.env.REDIS_PASSWORD ?? ''
                }
            },

            // TMDB
            tmdb: {
                apiKey: process.env.TMDB_API_KEY ?? '',
                cacheTTL: 24 * 60 * 60 // 24h
            },

            // Third Party Proxy removal
            proxyConfig: {
                knownThirdPartyProxies,
                streamPatterns
            },

            cors: {
                origin: process.env.CORS_ORIGIN ?? '*',
                methods: ['GET', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization'],
                exposedHeaders: ['Content-Range', 'Accept-Ranges', 'ETag'],
                preflightContinue: false,
                optionsSuccessStatus: 204
            },

            stremio: {
                // exposes a stremio addon on /stremio/manifest.json
                enableNativeAddon: process.env.STREMIO_ADDON === 'true',
                stremioAddons: []
            },

            // MCP for AI agents
            mcp: {
                enabled: process.env.MCP_ENABLED === 'true'
            }
        });

        // Register providers
        const registry = server.getRegistry();
        await registry.discoverProviders(providersDir());

        await server.app.ready();
        return server.app;
    })();
    return appPromise;
}

export default async function handler(req, res) {
    const app = await bootApp();
    app.server.emit('request', req, res);
}
