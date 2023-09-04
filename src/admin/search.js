"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitize = exports.simplify = exports.filterDirectories = exports.getDictionary = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const nconf_1 = __importDefault(require("nconf"));
const winston_1 = __importDefault(require("winston"));
const file = __importStar(require("../file"));
const translator_1 = require("../translator");
function filterDirectories(directories) {
    return directories.map(
    // get the relative path
    // convert dir to use forward slashes
    dir => dir.replace(/^.*(admin.*?).tpl$/, '$1').split(path.sep).join('/')).filter(
    // exclude .js files
    // exclude partials
    // only include subpaths
    // exclude category.tpl, group.tpl, category-analytics.tpl
    dir => (!dir.endsWith('.js') &&
        !dir.includes('/partials/') &&
        /\/.*\//.test(dir) &&
        !/manage\/(category|group|category-analytics)$/.test(dir)));
}
exports.filterDirectories = filterDirectories;
function getAdminNamespaces() {
    return __awaiter(this, void 0, void 0, function* () {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const directories = yield file.walk(path.resolve(nconf_1.default.get('views_dir'), 'admin'));
        return filterDirectories(directories);
    });
}
function sanitize(html) {
    // reduce the template to just meaningful text
    // remove all tags and strip out scripts, etc completely
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return (0, sanitize_html_1.default)(html, {
        allowedTags: [],
        allowedAttributes: [],
    });
}
exports.sanitize = sanitize;
function simplify(translations) {
    return translations
        // remove all mustaches
        .replace(/(?:\{{1,2}[^}]*?\}{1,2})/g, '')
        // collapse whitespace
        .replace(/(?:[ \t]*[\n\r]+[ \t]*)+/g, '\n')
        .replace(/[\t ]+/g, ' ');
}
exports.simplify = simplify;
function nsToTitle(namespace) {
    return namespace.replace('admin/', '').split('/').map(str => str[0].toUpperCase() + str.slice(1)).join(' > ')
        .replace(/[^a-zA-Z> ]/g, ' ');
}
const fallbackCache = {};
function initFallback(namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const template = yield fs.promises.readFile(path.resolve(nconf_1.default.get('views_dir'), `${namespace}.tpl`), 'utf8');
        const title = nsToTitle(namespace);
        let translations = sanitize(template);
        translations = translator_1.Translator.removePatterns(translations);
        translations = simplify(translations);
        translations += `\n${title}`;
        return {
            namespace: namespace,
            translations: translations,
            title: title,
        };
    });
}
function fallback(namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fallbackCache[namespace]) {
            return fallbackCache[namespace];
        }
        const params = yield initFallback(namespace);
        fallbackCache[namespace] = params;
        return params;
    });
}
function buildNamespace(language, namespace) {
    return __awaiter(this, void 0, void 0, function* () {
        const translator = translator_1.Translator.create(language);
        try {
            const translations = yield translator.getTranslation(namespace);
            if (!translations || !Object.keys(translations).length) {
                return yield fallback(namespace);
            }
            // join all translations into one string separated by newlines
            let str = Object.values(translations).join('\n');
            str = sanitize(str);
            const titleMatch = namespace.match(/admin\/(.+?)\/(.+?)$/);
            const title = titleMatch ?
                `[[admin/menu:section-${titleMatch[1] === 'development' ? 'advanced' : titleMatch[1]}]]${titleMatch[2] ? (` > [[admin/menu:${titleMatch[1]}/${titleMatch[2]}]]`) : ''}` : '';
            const translatedTitle = yield translator.translate(title);
            return {
                namespace: namespace,
                translations: `${str}\n${title}`,
                title: translatedTitle,
            };
        }
        catch (err) {
            if (err instanceof Error) {
                winston_1.default.error(err.stack);
            }
            return {
                namespace: namespace,
                translations: '',
            };
        }
    });
}
function initDict(language) {
    return __awaiter(this, void 0, void 0, function* () {
        const namespaces = yield getAdminNamespaces();
        return yield Promise.all(namespaces.map(ns => buildNamespace(language, ns)));
    });
}
const cache = {};
function getDictionary(language) {
    return __awaiter(this, void 0, void 0, function* () {
        if (cache[language]) {
            return cache[language];
        }
        const params = yield initDict(language);
        cache[language] = params;
        return params;
    });
}
exports.getDictionary = getDictionary;
