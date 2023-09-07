import * as fs from 'fs';
import * as path from 'path';
import sanitizeHTML from 'sanitize-html';
import nconf from 'nconf';
import winston from 'winston';

import * as file from '../file';
import { Translator } from '../translator';

interface FallbackCache {
    [key: string]: {
        namespace: string;
        translations: string;
        title?: string;
    };
}

interface DictCache {
    [key: string]: {
        namespace: string;
        translations: string;
        title?: string;
    }[];
}

function filterDirectories(directories: string[]): string[] {
    return directories.map(
        // get the relative path, convert dir to use forward slashes
        dir => dir.replace(/^.*(admin.*?).tpl$/, '$1').split(path.sep).join('/')
    ).filter(
        // exclude .js files
        // exclude partials
        // only include subpaths
        // exclude category.tpl, group.tpl, category-analytics.tpl
        dir => (
            !dir.endsWith('.js') &&
            !dir.includes('/partials/') &&
            /\/.*\//.test(dir) &&
            !/manage\/(category|group|category-analytics)$/.test(dir)
        )
    );
}

async function getAdminNamespaces(): Promise<string[]> {
    const directories = await file.walk(path.resolve(nconf.get('views_dir') as string, 'admin')) as string[];
    return filterDirectories(directories);
}

function sanitize(html: string): string {
    // reduce the template to just meaningful text
    // remove all tags and strip out scripts, etc completely
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return sanitizeHTML(html, {
        allowedTags: [],
        allowedAttributes: [],
    }) as string;
}

function simplify(translations: string): string {
    return translations
    // remove all mustaches
        .replace(/(?:\{{1,2}[^}]*?\}{1,2})/g, '')
    // collapse whitespace
        .replace(/(?:[ \t]*[\n\r]+[ \t]*)+/g, '\n')
        .replace(/[\t ]+/g, ' ');
}

function nsToTitle(namespace: string): string {
    return namespace.replace('admin/', '').split('/').map(str => str[0].toUpperCase() + str.slice(1)).join(' > ')
        .replace(/[^a-zA-Z> ]/g, ' ');
}

const fallbackCache: FallbackCache = {};

async function initFallback(namespace: string): Promise<{
    namespace: string;
    translations: string;
    title?: string;
}> {
    const template = await fs.promises.readFile(path.resolve(nconf.get('views_dir') as string, `${namespace}.tpl`), 'utf8');

    const title = nsToTitle(namespace);
    let translations = sanitize(template);
    translations = Translator.removePatterns(translations);
    translations = simplify(translations);
    translations += `\n${title}`;

    return {
        namespace: namespace,
        translations: translations,
        title: title,
    };
}

async function fallback(namespace: string): Promise<{
    namespace: string;
    translations: string;
    title?: string;
}> {
    if (fallbackCache[namespace]) {
        return fallbackCache[namespace];
    }

    const params = await initFallback(namespace);
    fallbackCache[namespace] = params;
    return params;
}

async function buildNamespace(language: string, namespace: string): Promise<{
    namespace: string;
    translations: string;
    title?: string;
}> {
    const translator = Translator.create(language);
    try {
        const translations: object = await translator.getTranslation(namespace);
        if (!translations || !Object.keys(translations).length) {
            return await fallback(namespace);
        }
        // join all translations into one string separated by newlines
        let str: string = Object.values(translations).join('\n');
        str = sanitize(str);

        const titleMatch = namespace.match(/admin\/(.+?)\/(.+?)$/);

        const title = titleMatch ?
            `[[admin/menu:section-${
                titleMatch[1] === 'development' ? 'advanced' : titleMatch[1]
            }]]${titleMatch[2] ? (` > [[admin/menu:${
                titleMatch[1]}/${titleMatch[2]}]]`) : ''}` : '';

        const translatedTitle = await translator.translate(title);
        return {
            namespace: namespace,
            translations: `${str}\n${title}`,
            title: translatedTitle,
        };
    } catch (err) {
        if (err instanceof Error) {
            winston.error(err.stack);
        }
        return {
            namespace: namespace,
            translations: '',
        };
    }
}

async function initDict(language: string): Promise<{
    namespace: string;
    translations: string;
    title?: string;
}[]> {
    const namespaces = await getAdminNamespaces();
    return await Promise.all(namespaces.map(ns => buildNamespace(language, ns)));
}

const cache: DictCache = {};

async function getDictionary(language: string): Promise<{
    namespace: string;
    translations: string;
    title?: string;
}[]> {
    if (cache[language]) {
        return cache[language];
    }

    const params = await initDict(language);
    cache[language] = params;
    return params;
}

export {
    getDictionary,
    filterDirectories,
    simplify,
    sanitize,
};
