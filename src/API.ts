import { APIConfig, BaseConfig, bodyAsParams, iApi, iPipe, PipeRequest, PipeResponse, URN, URNParser } from "./type&interface";

/**
 * main entry to generate the SimplifiedFetch
 * @public
 */
export default class API {
    // baseConfig = {}
    // constructor() {
    //     Object.freeze(API.baseConfig)
    // }
    /**
     * global basic config
     * @defaultValue
     * ```json
     * method: 'GET',
     * bodyMixin: 'json',
     * headers: {
     *    "Content-Type": "application/json",
     * },
     * enableAbort: false,
     * pureResponse: false,
     * ```
     */
    static readonly baseConfig: BaseConfig = {
        method: 'GET',
        bodyMixin: 'json',
        headers: {
            "Content-Type": "application/json",
        },
        enableAbort: false,
        pureResponse: false,
    }

    /**
     * init Api or [newName] on globalThis
     * @param baseConfig - {@link BaseConfig}
     * @param apis - {@link APIConfig}
     */
    static init(baseConfig: BaseConfig, apis: APIConfig) {
        let _: any = (function () {
            if (typeof globalThis === 'object' && globalThis) return globalThis
            if (typeof window === 'object' && window) return window
            if (typeof self === 'object' && self) return self
            // for node
            if (typeof global === 'object' && global) return global
            throw new Error(`unable to get globalThis, try 'import 'simplified-fetch/polyfill/globalThis'' before init`)
        })()

        _[baseConfig?.newName || 'Api']
            = new Api(apis, mergeConfig(API.baseConfig, baseConfig))
    }
    /**
     * create and return the new Api
     * @param baseConfig - {@link BaseConfig}
     * @param apis - {@link APIConfig}
     * @returns SimplifiedFetch
     */
    static create(baseConfig: BaseConfig, apis: APIConfig) {
        return new Api(apis, mergeConfig(API.baseConfig, baseConfig))
    }
}

/**
 * The unified API request object, also 'SimplifiedFetch'
 */
class Api implements iApi {
    /**
     * {@link PipeRequest}
     */
    request = new Pipe<PipeRequest>()
    /**
     * {@link PipeResponse}
     */
    response = new Pipe<PipeResponse>()
    /**
     * constructor of Api, return SimplifiedFetch
     * @param apis - {@link APIConfig}
     * @param baseConfig - {@link BaseConfig}
     */
    constructor(apis: APIConfig, baseConfig: BaseConfig = API.baseConfig) {
        for (const [api, { urn, config = {} }] of Object.entries(apis)) {

            // pipe request
            // issue: unable to be async?
            // issue: how to control the core operation with appropriate fine granularity
            // optional position
            // for (const [key, func] of this.request.pipeMap) {
            //     func()
            // }

            const configMerged: BaseConfig = mergeConfig(baseConfig, config)

            let controller: AbortController, signal: AbortSignal, abort = configMerged?.enableAbort
            if (abort) {
                controller = new AbortController()
                signal = controller.signal
                configMerged.signal = signal;
                (<any>this).aborts[api] = [controller, signal]
            }

            (<any>this)[api] = (body?: bodyAsParams, params?: Array<any>): Promise<any> => {

                const urlMerged = mergeURL(urn, configMerged, params)
                urlMerged.pathname += configMerged?.suffix ?? ''
                const urlFinal = body ? getURL(urlMerged, configMerged, body) : urlMerged

                // pipe request
                // too many parameters, but good for bug fix when people use this
                for (const [key, func] of this.request.pipeMap) {
                    func(urlFinal, configMerged, [body, params], [api, urn, config, baseConfig])
                }

                return new Promise((resolve, reject) => {
                    if (typeof abort === 'number') {
                        (<any>signal)['timeout'] = abort
                        setTimeout(controller.abort, abort)
                    }

                    const request = new Request(urlFinal.toString(), configMerged)
                    fetch(request)
                        .then(async response => {

                            // pipe response
                            for (const [key, func] of this.response.pipeMap) {
                                await func(response, request, [resolve, reject])
                            }
                            // too many parameters
                            // await [...this.response.pipeMap.values()].reduce(
                            //     async (result, func, index, array) => await func([resolve, reject], response, request, [result, index, array])
                            //     , undefined)

                            processResponse([resolve, reject], response, configMerged?.bodyMixin, configMerged?.pureResponse)
                        })
                        .catch(e => {
                            // https://developer.mozilla.org/en-US/docs/Web/API/DOMException
                            // if (e?.code === 20) {
                            if (e.name === 'AbortError') {
                                (<any>e)['timeout'] = abort
                            }
                            throw e
                        })
                })
            }
        }
    }
}

/**
 * use ordered Map to manage the pipe<function>
 * {@link iPipe}
 */
class Pipe<T> implements iPipe<T> {
    pipeMap = new Map<string, T>()
    use = (pipe: T): string => {
        const key = Math.random().toString(16).slice(-3)
        this.pipeMap.set(key, pipe)
        return key
    }
    eject = (key: string): boolean => {
        return this.pipeMap.delete(key)
    }
}

/**
 * transform the response and resolve([pure response, res] or res)
 * @param param0 - [resolve, reject] end the pipeline
 * @param response - origin pure response, {@link https://developer.mozilla.org/en-US/docs/Web/API/Response}
 * @param bodyMixin - {@link BodyMixin}
 * @param pure - get from config, whether resolve with Response.clone()
 */
function processResponse([resolve, reject]: Array<Function>, response: Response, bodyMixin: string = 'json', pure: boolean = false) {
    const pureResponse: Response | undefined = pure ? response.clone() : undefined;
    (<any>response)[bodyMixin]()
        .then((res: any) => resolve(pure ? [res, pureResponse] : res))
    // .catch(reject)
}

/**
 * merge globalConfig with localConfig
 * @param baseConfig - {@link BaseConfig}
 * @param newConfig - {@link BaseConfig}
 * @returns new object with final config
 */
function mergeConfig(baseConfig: BaseConfig, newConfig: BaseConfig): BaseConfig {
    const headers = Object.assign({}, baseConfig?.headers, newConfig?.headers)
    return {
        ...baseConfig,
        ...newConfig,
        headers,
    }
}

/**
 * generate fetch url
 * @param urn - {@link URN}
 * @param config - {@link BaseConfig}
 * @param params - Api.someApi(body, params), use for step: urnParser
 * @returns url wait to fetch
 */
function mergeURL(urn: URN, config: BaseConfig, params?: Array<any>): URL {
    // todo: params now is just for urn. if urn isn't function, then auto parse params to string +=url.search
    // why: body is just for body, if wrong method, then parser. this one is done.
    // Both are almost the same thing.

    // https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
    return new URL(typeof urn === 'function' ? urn(params) : urn, config?.baseURL ?? '')
}

/**
 * transform user's body properly tn fetch's body
 * @param url - {@link https://developer.mozilla.org/en-US/docs/Web/API/URL}
 * @param config - {@link BaseConfig}
 * @param body - {@link bodyAsParams}
 * @returns final url and config for fetch
 */
function getURL(url: URL, config: BaseConfig, body: bodyAsParams): URL {
    const bodyType = Object.prototype.toString.call(body)
    // reasons: Failed to execute 'fetch' on 'Window': Request with ！GET/HEAD！ method cannot have body.
    if (['GET', 'HEAD'].includes(config.method!.toUpperCase())) {
        // situation: 'xxx',xxx/','xxx/?','xxx/?a=1','xxx/?a=1&',
        const search = url.search.includes('?')
        // this won't be done automatically on Chromium
        url.search += search && url.search.slice(-1)[0] !== '&' ? '&' : ''

        switch (bodyType) {
            case '[object Object]':
                // issue: bug when strange body comes
                // @ts-ignore
                url.search += new URLSearchParams(body).toString()
                break;
            case '[object FormData]':
                // https://developer.mozilla.org/en-US/docs/Web/API/FormData
                /*
                You can also pass it directly to the URLSearchParams constructor
                if you want to generate query parameters in the way a <form> would do
                if it were using simple GET submission.
                 */
                // @ts-ignore
                // https://github.com/microsoft/TypeScript/issues/30584
                url.search += new URLSearchParams(body).toString()
                break;
            case '[object URLSearchParams]':
                url.search += body.toString()
                break
            // this will be done automatically on Chromium
            // todo: more compatibility Test?
            // if (search) {
            //     url.search = '?'.concat(url.search)
            // }

            case '[object Array]':
                url.pathname += `/${body.toString()}`
                break;
            case '[object String]':
                url.pathname += `/${body.toString()}`
                break;
            case '[object Number]':
                url.pathname += `/${body.toString()}`
                break;
        }
    } else {
        //  obj2json,exclude
        //  ['[object Blob]','[object ArrayBuffer]','[object FormData]',
        //  '[object URLSearchParams]','[object ReadableStream]','[object String]']
        if (bodyType === '[object Object]' || Array.isArray(body)) {
            body = JSON.stringify(body)
        }
        config.body = <any>body
    }
    return url
}

/**
 * parse the template strings with params
 * 
 * @example
 * ```ts
 * // init
 * someApi:{
 *   urn: urnParser(`/xxx/${0}/${1}`)
 * }
 * // somewhere
 * Api.someApi(body,['user', [1,2,3]])
 * // getUrl: /xxx/user/1,2,3
 * ```
 * @param template - template strings
 * @param placeholder - indexes of params, like $\{0\}
 * @returns {@link URNParser}
 * 
 * @remarks
 * function base on Template literals (Template strings)
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals}
 * you do can use the string type as placehloder, and give an Object as params, match them with key string.
 * But the way it used would look like: urnParser`/${'key1'}/${'key2'}`, Api.someApi(body, \{key1:'',key2:''\})
 * Anyway, need better idea.
 * 
 * @public
 */
export const urnParser = (template: Array<string>, ...placeholder: Array<number>): URNParser => {
    return (params?: Array<any>): string => {
        return template.reduce((previousValue, currentValue, index) => {
            return previousValue + currentValue + (params?.[placeholder[index]] ?? '')
        }, '')
    }
}
